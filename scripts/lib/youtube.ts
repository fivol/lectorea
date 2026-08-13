import { env, requireYoutubeKeys } from './config.js';
import {
  exhaustKey,
  keyId,
  saveRaw,
  spendQuota,
  spentToday,
  spentTodayTotal,
  type Db,
} from './db.js';

/**
 * Thin wrapper over the YouTube Data API v3 with quota accounting.
 *
 * The daily quota is 10 000 units **per Google Cloud project**, and the client
 * spends one key at a time, moving to the next when one runs out — so two keys
 * from two projects are two days of crawling in one evening. The single most
 * important rule: never call `search.list` — it costs 100 units per call, and a
 * full crawl through it would burn the whole day in a hundred requests.
 * Everything here is built out of the 1-unit endpoints only:
 *
 *   channels.list        1   uploads playlist of a channel
 *   playlists.list       1   metadata for up to 50 playlists at once
 *   playlistItems.list   1   one page of a playlist's videos
 *   videos.list          1   durations and stats for up to 50 videos at once
 *
 * Plain fetch rather than `googleapis`: the surface used here is four GET
 * endpoints, and every call has to pass through the quota ledger anyway.
 */

const BASE = 'https://www.googleapis.com/youtube/v3';

export class QuotaExceededError extends Error {
  constructor() {
    super('YouTube API quota exhausted');
    this.name = 'QuotaExceededError';
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`Not found or private: ${what}`);
    this.name = 'NotFoundError';
  }
}

export class TransientError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'TransientError';
  }
}

export type YoutubeClient = ReturnType<typeof createClient>;

export function createClient(db: Db) {
  const configured = requireYoutubeKeys();
  const keys = configured.map((key, index) => ({
    key,
    id: keyId(key),
    label: `key ${index + 1}/${configured.length}`,
  }));

  /**
   * The first key with room for the call, or nothing when the day is over.
   *
   * Keys are spent in order rather than balanced. A crawl that ends mid-queue
   * should leave the untouched key obviously untouched — two keys both
   * mysteriously at 6000 is a state nobody can reason about tomorrow. The
   * ceiling stops each one well short of its hard limit, so a job already in
   * flight can still finish.
   */
  function pickKey(cost: number) {
    return keys.find((candidate) => spentToday(db, candidate.id) + cost <= env.quotaCeiling);
  }

  async function call<T>(
    endpoint: string,
    params: Record<string, string>,
    cost = 1
  ): Promise<T> {
    // A loop rather than a single choice, because the ledger is only this
    // machine's memory of the day while the API's 403 is the fact. A key that
    // looks fresh here but is spent in reality — a clone with no cache.db, a
    // project CI has been crawling on — is found out on its first call,
    // written off, and the same request goes out again on the next key. One
    // pass per key: each turn of the loop writes off at most one.
    for (let attempt = 0; attempt < keys.length; attempt += 1) {
      const chosen = pickKey(cost);
      if (!chosen) break;

      const query = new URLSearchParams({ ...params, key: chosen.key });
      const url = `${BASE}/${endpoint}?${query.toString()}`;
      const response = await fetch(url);
      spendQuota(db, chosen.id, cost);

      if (response.status === 403) {
        const body = await response.text();
        // Two different 403s wear the same status. `quotaExceeded` is the day's
        // 10 000 units and means this key is finished; `rateLimitExceeded` is a
        // burst limit measured in seconds and means wait a moment. Reading the
        // second as the first throws away a whole key over one busy instant —
        // and it is the one concurrency provokes.
        if (body.includes('rateLimitExceeded') || body.includes('userRateLimitExceeded')) {
          throw new TransientError(`${endpoint} rate limited`, 403);
        }
        if (body.includes('quotaExceeded') || body.includes('dailyLimitExceeded')) {
          exhaustKey(db, chosen.id, env.quotaCeiling);
          console.log(`· ${chosen.label} is out of quota`);
          continue;
        }
        throw new NotFoundError(`${endpoint} ${JSON.stringify(params)}`);
      }
      if (response.status === 404) {
        throw new NotFoundError(`${endpoint} ${JSON.stringify(params)}`);
      }
      if (response.status >= 500) {
        throw new TransientError(`${endpoint} returned ${response.status}`, response.status);
      }
      if (!response.ok) {
        throw new Error(`${endpoint} returned ${response.status}: ${await response.text()}`);
      }

      const body = (await response.json()) as T;
      // Raw bodies are kept so a parser fix costs nothing instead of a day of quota.
      saveRaw(db, endpoint, JSON.stringify(params), body);
      return body;
    }

    throw new QuotaExceededError();
  }

  return {
    /** Resolves `@handle` or a channel id to its metadata and uploads playlist. */
    async channel(idOrHandle: string): Promise<{
      id: string;
      title: string;
      uploadsPlaylistId: string;
    } | null> {
      const params: Record<string, string> = {
        part: 'snippet,contentDetails',
        // channels.yaml accepts either form so the file stays readable.
        [idOrHandle.startsWith('@') ? 'forHandle' : 'id']: idOrHandle,
      };

      const body = await call<ChannelListResponse>('channels', params);
      const item = body.items?.[0];
      if (!item) return null;
      return {
        id: item.id,
        title: item.snippet.title,
        uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
      };
    },

    /**
     * Subscriber counts for up to 50 channels per unit.
     *
     * A channel may hide the count, and then the API answers `hiddenSubscriberCount`
     * with a zero — a real zero and a hidden one are the same number, so the flag
     * is carried through rather than the caller guessing from `0`.
     */
    async channelStats(
      ids: string[]
    ): Promise<Array<{ id: string; subscribers: number; hidden: boolean }>> {
      const collected: Array<{ id: string; subscribers: number; hidden: boolean }> = [];
      for (const chunk of chunked(ids, 50)) {
        const body = await call<ChannelStatsResponse>('channels', {
          part: 'statistics',
          id: chunk.join(','),
          maxResults: '50',
        });
        for (const item of body.items ?? []) {
          collected.push({
            id: item.id,
            subscribers: Number(item.statistics?.subscriberCount ?? 0),
            hidden: Boolean(item.statistics?.hiddenSubscriberCount),
          });
        }
      }
      return collected;
    },

    /** All playlists owned by a channel, paging 50 at a time. */
    async channelPlaylists(channelId: string): Promise<PlaylistItem[]> {
      const collected: PlaylistItem[] = [];
      let pageToken: string | undefined;
      do {
        const body = await call<PlaylistListResponse>('playlists', {
          part: 'snippet,contentDetails,status',
          channelId,
          maxResults: '50',
          ...(pageToken ? { pageToken } : {}),
        });
        collected.push(...(body.items ?? []));
        pageToken = body.nextPageToken;
      } while (pageToken);
      return collected;
    },

    /** Metadata for up to 50 playlists in a single unit. */
    async playlists(ids: string[]): Promise<PlaylistItem[]> {
      const collected: PlaylistItem[] = [];
      for (const chunk of chunked(ids, 50)) {
        const body = await call<PlaylistListResponse>('playlists', {
          part: 'snippet,contentDetails,status',
          id: chunk.join(','),
          maxResults: '50',
        });
        collected.push(...(body.items ?? []));
      }
      return collected;
    },

    /** Video ids of a playlist, in order. */
    async playlistVideoIds(playlistId: string): Promise<string[]> {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const body = await call<PlaylistItemsResponse>('playlistItems', {
          part: 'contentDetails',
          playlistId,
          maxResults: '50',
          ...(pageToken ? { pageToken } : {}),
        });
        for (const item of body.items ?? []) {
          if (item.contentDetails?.videoId) ids.push(item.contentDetails.videoId);
        }
        pageToken = body.nextPageToken;
      } while (pageToken);
      return ids;
    },

    /** Durations, titles and statistics for up to 50 videos per unit. */
    async videos(ids: string[]): Promise<VideoItem[]> {
      const collected: VideoItem[] = [];
      for (const chunk of chunked(ids, 50)) {
        const body = await call<VideoListResponse>('videos', {
          part: 'snippet,contentDetails,statistics',
          id: chunk.join(','),
          maxResults: '50',
        });
        collected.push(...(body.items ?? []));
      }
      return collected;
    },

    spent: () => spentTodayTotal(db),
    remaining: () =>
      keys.reduce(
        (left, candidate) => left + Math.max(0, env.quotaCeiling - spentToday(db, candidate.id)),
        0
      ),
  };
}

/* ────────────────────────────────  Helpers  ────────────────────────────── */

export function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/** `PT1H23M45S` → seconds. */
export function parseDuration(iso: string): number {
  const match = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

/* ─────────────────────────────  API response types  ────────────────────── */

type ChannelListResponse = {
  items?: Array<{
    id: string;
    snippet: { title: string };
    contentDetails: { relatedPlaylists: { uploads: string } };
  }>;
};

type ChannelStatsResponse = {
  items?: Array<{
    id: string;
    statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
  }>;
};

export type PlaylistItem = {
  id: string;
  snippet: {
    title: string;
    description: string;
    channelId: string;
    channelTitle: string;
    publishedAt: string;
    defaultLanguage?: string;
  };
  contentDetails: { itemCount: number };
  status?: { privacyStatus: string };
};

type PlaylistListResponse = { items?: PlaylistItem[]; nextPageToken?: string };

type PlaylistItemsResponse = {
  items?: Array<{ contentDetails?: { videoId: string } }>;
  nextPageToken?: string;
};

export type VideoItem = {
  id: string;
  snippet: { title: string; publishedAt: string; defaultAudioLanguage?: string };
  contentDetails: { duration: string; caption: string };
  statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
};

type VideoListResponse = { items?: VideoItem[] };
