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
 * important rule: the crawl is built out of the 1-unit endpoints only, and
 * never reaches for `search.list`, which costs 100 — a full crawl through it
 * would burn the whole day in a hundred requests.
 *
 *   channels.list        1   uploads playlist of a channel
 *   playlists.list       1   metadata for up to 50 playlists at once
 *   playlistItems.list   1   one page of a playlist's videos
 *   videos.list          1   durations and stats for up to 50 videos at once
 *   search.list        100   off by default — see `allowSearch` below
 *
 * That rule used to be this comment and nothing else, which is why it is now
 * `createClient(db, { allowSearch: true })`: a pipeline step that reaches for
 * `search` gets an exception on the first call rather than a surprise in the
 * ledger. Only `scripts/_hunt.ts` passes it, and only against quota that would
 * otherwise expire unspent — docs/harvest.md#seam-8.
 *
 * Plain fetch rather than `googleapis`: the surface used here is five GET
 * endpoints, and every call has to pass through the quota ledger anyway.
 */

const BASE = 'https://www.googleapis.com/youtube/v3';

/** What one `search.list` page costs, whatever `maxResults` says. */
export const SEARCH_COST = 100;

/** One row of `search.list`, flattened: the response nests the id by kind. */
export type SearchHit = {
  id: string;
  kind: 'playlist' | 'channel' | 'video';
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
};

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

export function createClient(db: Db, { allowSearch = false } = {}) {
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

    /**
     * Video ids of a playlist, in order.
     *
     * Some playlists answer with a `nextPageToken` that leads back to the page
     * that produced it. Nothing downstream notices — the same fifty ids arrive
     * again and the walk simply never ends — and every turn of that loop is a
     * unit. Six playlists spent 54 000 units this way on 2026-08-13, and two of
     * them had been spinning since the evening before, which is most of two
     * days' quota for six lists of nursery rhymes and car videos. A token
     * already seen is therefore the end of the playlist, not its next page.
     */
    async playlistVideoIds(playlistId: string): Promise<string[]> {
      const ids: string[] = [];
      const seen = new Set<string>();
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
        if (pageToken && seen.has(pageToken)) {
          console.warn(`! ${playlistId}: pagination repeats after ${seen.size} pages — stopping`);
          break;
        }
        if (pageToken) seen.add(pageToken);
      } while (pageToken);
      return ids;
    },

    /**
     * Who actually made the videos in a playlist — one page, one unit.
     *
     * The question a title cannot answer. «Linguistics» owning fifty videos is
     * a course when a linguist uploaded all fifty and a bag of bookmarks when
     * they come from forty different channels, and the two are indistinguishable
     * from anything `playlists.list` returns. `playlistItems` carries the owner
     * of each video beside the id of whoever made the playlist, so one page of
     * fifty settles it before the expensive walk is paid for.
     *
     * One page on purpose: the first fifty videos of a bag are already forty
     * owners, and a course that changes hands at video 60 is not a thing.
     */
    async playlistOwnership(playlistId: string): Promise<{
      sampled: number;
      ownerId: string;
      own: number;
      foreign: Array<{ id: string; title: string; count: number }>;
    }> {
      const body = await call<PlaylistItemsSnippetResponse>('playlistItems', {
        part: 'snippet',
        playlistId,
        maxResults: '50',
      });
      const items = body.items ?? [];
      const ownerId = items[0]?.snippet?.channelId ?? '';
      const byOwner = new Map<string, { id: string; title: string; count: number }>();
      let own = 0;
      let sampled = 0;

      for (const item of items) {
        const videoOwner = item.snippet?.videoOwnerChannelId;
        // A deleted or private video carries no owner. It is not evidence
        // either way, so it is left out of the denominator rather than counted
        // against the playlist — half a course going private is a dead course,
        // which `04-liveness.ts` is the one that decides.
        if (!videoOwner) continue;
        sampled += 1;
        if (videoOwner === ownerId) {
          own += 1;
          continue;
        }
        const entry = byOwner.get(videoOwner) ?? {
          id: videoOwner,
          title: unescapeHtml(item.snippet?.videoOwnerChannelTitle ?? ''),
          count: 0,
        };
        entry.count += 1;
        byOwner.set(videoOwner, entry);
      }

      return {
        sampled,
        ownerId,
        own,
        foreign: [...byOwner.values()].sort((a, b) => b.count - a.count),
      };
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

    /**
     * One page of YouTube's own search — 50 results for 100 units.
     *
     * Off unless the caller asked for it at construction, because the price is
     * a hundred times everything else in this file and the mistake it prevents
     * is silent: a step that called it in a loop would spend the day in a
     * hundred requests and report nothing unusual.
     *
     * One page and no paging. The second page of a query costs the same 100
     * units as the first page of a different one and is worth far less — search
     * ranks by relevance, so page two of «поэтика» is below page one of
     * «стиховедение». A caller that wants more asks a different question.
     *
     * The titles are HTML-escaped in this response and only in this response
     * (`Bird&#39;s-eye`), so they are unescaped here rather than at each call
     * site: what comes out of every method in this file is a plain title.
     */
    async search(
      query: string,
      options: { kind: 'playlist' | 'channel' | 'video'; lang?: string; region?: string }
    ): Promise<SearchHit[]> {
      if (!allowSearch) {
        throw new Error(
          'search.list costs 100 units and is off by default. The crawl is built out of the ' +
            '1-unit endpoints; if you mean it, use createClient(db, { allowSearch: true }).'
        );
      }
      const body = await call<SearchResponse>(
        'search',
        {
          part: 'snippet',
          q: query,
          type: options.kind,
          maxResults: '50',
          ...(options.lang ? { relevanceLanguage: options.lang } : {}),
          ...(options.region ? { regionCode: options.region } : {}),
        },
        SEARCH_COST
      );
      const hits: SearchHit[] = [];
      for (const item of body.items ?? []) {
        const id = item.id?.playlistId ?? item.id?.channelId ?? item.id?.videoId;
        if (!id) continue;
        hits.push({
          id,
          kind: options.kind,
          title: unescapeHtml(item.snippet?.title ?? ''),
          description: unescapeHtml(item.snippet?.description ?? ''),
          channelId: item.snippet?.channelId ?? '',
          channelTitle: unescapeHtml(item.snippet?.channelTitle ?? ''),
          publishedAt: item.snippet?.publishedAt ?? '',
        });
      }
      return hits;
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

/**
 * `search.list` is the one endpoint that returns titles HTML-escaped, and it
 * escapes only these five. Decoded numerically as well as by name, because the
 * same response says both `&#39;` and `&quot;`.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
};

export function unescapeHtml(text: string): string {
  const once = (value: string): string =>
    value.replace(/&(amp|lt|gt|quot|#39|#x27|#\d+);/g, (whole, name: string) => {
      if (name in ENTITIES) return ENTITIES[name];
      if (name === '#x27') return "'";
      const code = Number(name.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    });
  // Twice, because the response escapes its own escapes: a title with an
  // apostrophe arrives as `&amp;#39;`, and one pass leaves `&#39;` in the text.
  return once(once(text));
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

type SearchResponse = {
  items?: Array<{
    id?: { kind?: string; playlistId?: string; channelId?: string; videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      channelId?: string;
      channelTitle?: string;
      publishedAt?: string;
    };
  }>;
  nextPageToken?: string;
};

type PlaylistItemsSnippetResponse = {
  items?: Array<{
    snippet?: {
      /** Whoever owns the *playlist* — the same on every item. */
      channelId?: string;
      videoOwnerChannelId?: string;
      videoOwnerChannelTitle?: string;
    };
  }>;
};

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
