import { nowIso } from './config.js';
import type { Db } from './db.js';
import { enqueue } from './queue.js';
import { chunked, parseDuration, QuotaExceededError, type YoutubeClient } from './youtube.js';
import { detectLang } from './classify.js';
import { median } from './score.js';

/**
 * The individual pipeline steps.
 *
 * Which of them go through the job queue is a quota decision, not a style one:
 * anything the API will answer 50 at a time (playlist metadata, liveness) is
 * done in direct batches, because one job per playlist would turn one unit into
 * fifty. Only genuinely per-target work (crawling a channel, walking a
 * playlist's videos) is queued.
 */

/** Refresh intervals, in days. Without them every run re-spends the same quota. */
export const REFRESH_DAYS = {
  playlistMetadata: 30,
  statsPopular: 7,
  statsRegular: 30,
  liveness: 14,
  discover: 30,
};

export function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function isDue(value: string | null, days: number): boolean {
  if (!value) return true;
  return new Date(value).getTime() + days * 86_400_000 <= Date.now();
}

/* ────────────────────────────────  Discover  ───────────────────────────── */

export type ChannelSeed = { id: string; title: string; providerId: string; lang: string };

/** Queues a crawl for every channel whose discovery window has expired. */
export function queueDiscovery(db: Db, channels: ChannelSeed[], force = false): number {
  let queued = 0;
  for (const channel of channels) {
    const row = db
      .prepare(`SELECT last_discovered_at FROM channels WHERE handle = ? OR id = ?`)
      .get(channel.id, channel.id) as { last_discovered_at: string | null } | undefined;
    if (!force && row && !isDue(row.last_discovered_at, REFRESH_DAYS.discover)) continue;
    enqueue(db, 'discover', channel.id);
    queued += 1;
  }
  return queued;
}

export async function discoverChannel(
  db: Db,
  api: YoutubeClient,
  seed: ChannelSeed
): Promise<number> {
  const channel = await api.channel(seed.id);
  if (!channel) throw new Error(`channel not found: ${seed.id}`);

  db.prepare(
    `INSERT INTO channels (id, title, provider_id, uploads_playlist_id, handle, last_discovered_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       provider_id = excluded.provider_id,
       uploads_playlist_id = excluded.uploads_playlist_id,
       handle = excluded.handle,
       last_discovered_at = excluded.last_discovered_at`
  ).run(channel.id, channel.title, seed.providerId, channel.uploadsPlaylistId, seed.id, nowIso());

  const playlists = await api.channelPlaylists(channel.id);
  const insert = db.prepare(
    `INSERT INTO playlists
       (id, channel_id, title, description, video_count, published_at, lang, alive, checked_at, next_refresh_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       video_count = excluded.video_count,
       checked_at = excluded.checked_at`
  );

  const write = db.transaction(() => {
    for (const playlist of playlists) {
      // Playlists of one or two videos are almost never courses; skipping them
      // here keeps thousands of pointless video fetches out of the queue.
      if (playlist.contentDetails.itemCount < 3) continue;
      insert.run(
        playlist.id,
        channel.id,
        playlist.snippet.title,
        playlist.snippet.description ?? '',
        playlist.contentDetails.itemCount,
        playlist.snippet.publishedAt,
        playlist.snippet.defaultLanguage ?? detectLang(playlist.snippet.title, seed.lang),
        nowIso(),
        inDays(REFRESH_DAYS.playlistMetadata)
      );
      enqueue(db, 'videos', playlist.id);
    }
  });
  write();

  return playlists.length;
}

/* ──────────────────────────  Playlist metadata  ────────────────────────── */

/**
 * Refreshes playlist metadata 50 at a time. Popular playlists come round more
 * often — their numbers move, and they are the ones people actually sort by.
 */
export async function refreshPlaylistMetadata(
  db: Db,
  api: YoutubeClient,
  limit = 5000
): Promise<{ refreshed: number; quotaExhausted: boolean }> {
  const popularCutoff = popularThreshold(db);

  const due = (
    db
      .prepare(
        `SELECT id, views, stats_fetched_at FROM playlists
         WHERE alive = 1 ORDER BY views DESC LIMIT ?`
      )
      .all(limit) as Array<{ id: string; views: number | null; stats_fetched_at: string | null }>
  ).filter((row) =>
    isDue(
      row.stats_fetched_at,
      (row.views ?? 0) >= popularCutoff ? REFRESH_DAYS.statsPopular : REFRESH_DAYS.statsRegular
    )
  );

  if (!due.length) return { refreshed: 0, quotaExhausted: false };

  const update = db.prepare(
    `UPDATE playlists SET title = ?, description = ?, video_count = ?, published_at = ?,
                          checked_at = ?, next_refresh_at = ?
     WHERE id = ?`
  );
  const markDead = db.prepare(`UPDATE playlists SET alive = 0, checked_at = ? WHERE id = ?`);

  let refreshed = 0;
  for (const chunk of chunked(due.map((row) => row.id), 50)) {
    let items;
    try {
      items = await api.playlists(chunk);
    } catch (error) {
      if (error instanceof QuotaExceededError) return { refreshed, quotaExhausted: true };
      throw error;
    }

    const seen = new Set(items.map((item) => item.id));
    const write = db.transaction(() => {
      for (const item of items) {
        update.run(
          item.snippet.title,
          item.snippet.description ?? '',
          item.contentDetails.itemCount,
          item.snippet.publishedAt,
          nowIso(),
          inDays(REFRESH_DAYS.playlistMetadata),
          item.id
        );
        // Item count changed — the video list is stale too.
        enqueue(db, 'videos', item.id);
      }
      // Anything the API did not return in a batch it was asked for is gone.
      for (const id of chunk) if (!seen.has(id)) markDead.run(nowIso(), id);
    });
    write();
    refreshed += items.length;
  }

  return { refreshed, quotaExhausted: false };
}

/** Views level that puts a playlist in the top fifth of the catalogue. */
function popularThreshold(db: Db): number {
  const row = db
    .prepare(
      `SELECT views FROM playlists WHERE alive = 1 AND views IS NOT NULL
       ORDER BY views DESC
       LIMIT 1 OFFSET (SELECT COUNT(*) / 5 FROM playlists WHERE alive = 1 AND views IS NOT NULL)`
    )
    .get() as { views: number } | undefined;
  return row?.views ?? Infinity;
}

/* ─────────────────────────────────  Videos  ────────────────────────────── */

/**
 * Walks a playlist and stores its videos, then rolls the durations and
 * statistics up onto the playlist row. This is where a playlist's views, likes
 * and comments come from — the API reports statistics per video, not per list.
 */
export async function fetchPlaylistVideos(
  db: Db,
  api: YoutubeClient,
  playlistId: string
): Promise<number> {
  const ids = await api.playlistVideoIds(playlistId);
  if (!ids.length) {
    db.prepare(`UPDATE playlists SET alive = 0, checked_at = ? WHERE id = ?`).run(
      nowIso(),
      playlistId
    );
    return 0;
  }

  const videos = await api.videos(ids);
  const position = new Map(ids.map((id, index) => [id, index]));

  const insert = db.prepare(
    `INSERT INTO videos (id, playlist_id, position, title, duration_seconds, published_at, views, likes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       playlist_id = excluded.playlist_id,
       position = excluded.position,
       title = excluded.title,
       duration_seconds = excluded.duration_seconds,
       views = excluded.views,
       likes = excluded.likes`
  );

  let views = 0;
  let likes = 0;
  let comments = 0;
  const durations: number[] = [];
  const captions = new Set<string>();
  let earliest = '';

  const write = db.transaction(() => {
    // Stale rows first: a playlist can lose videos between crawls.
    db.prepare(`DELETE FROM videos WHERE playlist_id = ?`).run(playlistId);

    for (const video of videos) {
      const seconds = parseDuration(video.contentDetails.duration);
      durations.push(seconds);
      views += Number(video.statistics.viewCount ?? 0);
      likes += Number(video.statistics.likeCount ?? 0);
      comments += Number(video.statistics.commentCount ?? 0);
      if (video.contentDetails.caption === 'true') {
        captions.add(video.snippet.defaultAudioLanguage?.split('-')[0] ?? 'unknown');
      }
      if (!earliest || video.snippet.publishedAt < earliest) earliest = video.snippet.publishedAt;

      insert.run(
        video.id,
        playlistId,
        position.get(video.id) ?? 0,
        video.snippet.title,
        seconds,
        video.snippet.publishedAt,
        Number(video.statistics.viewCount ?? 0),
        Number(video.statistics.likeCount ?? 0)
      );
    }

    const total = durations.reduce((sum, value) => sum + value, 0);
    db.prepare(
      `UPDATE playlists SET video_count = ?, total_seconds = ?, median_seconds = ?,
                            views = ?, likes = ?, comments = ?, captions = ?,
                            published_at = COALESCE(?, published_at),
                            stats_fetched_at = ?, videos_fetched_at = ?, checked_at = ?,
                            next_refresh_at = ?
       WHERE id = ?`
    ).run(
      videos.length,
      total,
      Math.round(median(durations)),
      views,
      likes,
      comments,
      [...captions].filter((c) => c !== 'unknown').join(','),
      earliest || null,
      nowIso(),
      nowIso(),
      nowIso(),
      inDays(REFRESH_DAYS.statsRegular),
      playlistId
    );
  });
  write();

  return videos.length;
}

/* ────────────────────────────────  Liveness  ───────────────────────────── */

export async function checkLiveness(
  db: Db,
  api: YoutubeClient
): Promise<{ checked: number; dead: number; quotaExhausted: boolean }> {
  const due = (
    db
      .prepare(`SELECT id, checked_at FROM playlists WHERE alive = 1`)
      .all() as Array<{ id: string; checked_at: string | null }>
  )
    .filter((row) => isDue(row.checked_at, REFRESH_DAYS.liveness))
    .map((row) => row.id);

  if (!due.length) return { checked: 0, dead: 0, quotaExhausted: false };

  const markDead = db.prepare(`UPDATE playlists SET alive = 0, checked_at = ? WHERE id = ?`);
  const touch = db.prepare(`UPDATE playlists SET checked_at = ? WHERE id = ?`);

  let checked = 0;
  let dead = 0;

  for (const chunk of chunked(due, 50)) {
    let items;
    try {
      items = await api.playlists(chunk);
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return { checked, dead, quotaExhausted: true };
      }
      throw error;
    }

    const alive = new Set(items.map((item) => item.id));
    const write = db.transaction(() => {
      for (const id of chunk) {
        if (alive.has(id)) touch.run(nowIso(), id);
        else {
          // 404 and 403 on a playlist are permanent; they are not retried.
          markDead.run(nowIso(), id);
          dead += 1;
        }
      }
    });
    write();
    checked += chunk.length;
  }

  return { checked, dead, quotaExhausted: false };
}
