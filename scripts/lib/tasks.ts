import { nowIso } from './config.js';
import type { Db } from './db.js';
import { enqueue } from './queue.js';
import { chunked, parseDuration, QuotaExceededError, type YoutubeClient } from './youtube.js';
import { detectLang } from './classify.js';
import { cleanSegments, isNotACourse } from './rules.js';
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

/** A scheduled moment that has arrived. Unset means it never was scheduled. */
function isPast(value: string | null): boolean {
  return !value || new Date(value).getTime() <= Date.now();
}

/**
 * Whether a playlist's video list is worth walking again.
 *
 * Walking one is the most expensive thing the pipeline does — two units per
 * fifty videos, some 2400 for the whole catalogue — and the answer only changes
 * when the playlist gains or loses a video. So the question is asked of the
 * item count the cheap `playlists.list` already returned, and a list that has
 * never been walked always qualifies.
 */
function videoListStale(
  before: { video_count: number | null; videos_fetched_at: string | null } | undefined,
  itemCount: number
): boolean {
  if (!before?.videos_fetched_at) return true;
  return before.video_count !== itemCount;
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

  // Read before the upsert overwrites it: what the queue needs to know is
  // whether the count moved, and after the insert both sides read the new one.
  const before = knownPlaylists(db, playlists.map((playlist) => playlist.id));

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
      // A monthly re-discovery finds mostly the same playlists. Queuing every
      // one of them again would re-crawl the whole catalogue's videos for the
      // sake of the handful that actually changed.
      if (videoListStale(before.get(playlist.id), playlist.contentDetails.itemCount)) {
        enqueue(db, 'videos', playlist.id);
      }
    }
  });
  write();

  return playlists.length;
}

/** id → what is already stored, for the playlists in one batch. */
function knownPlaylists(
  db: Db,
  ids: string[]
): Map<string, { video_count: number | null; videos_fetched_at: string | null }> {
  const known = new Map<string, { video_count: number | null; videos_fetched_at: string | null }>();
  const select = db.prepare(
    `SELECT video_count, videos_fetched_at FROM playlists WHERE id = ?`
  );
  for (const id of ids) {
    const row = select.get(id) as
      | { video_count: number | null; videos_fetched_at: string | null }
      | undefined;
    if (row) known.set(id, row);
  }
  return known;
}

/* ─────────────────────────  Playlists known by id  ─────────────────────── */

/**
 * Channel ids a playlist carries before the crawler has met its real channel.
 * A playlist can arrive as a bare id — imported from an awesome-list, or
 * written into `overrides.yaml` from an issue — and there is nowhere to look
 * the channel up until the metadata call answers.
 */
const PLACEHOLDER_CHANNEL = 'proposed';
const PLACEHOLDER_CHANNELS = [PLACEHOLDER_CHANNEL, 'imported'];
const PLACEHOLDER_CHANNELS_SQL = `(${PLACEHOLDER_CHANNELS.map((id) => `'${id}'`).join(', ')})`;

/**
 * Playlists bound by hand in `overrides.yaml` that the crawl has never seen.
 *
 * A binding written by hand — by `data:review`, or when an issue is accepted
 * with nothing in it but a link — is the one case where the catalogue knows
 * about a playlist before the crawler does. Without this the binding does
 * nothing at all and says nothing about it: the build reads playlists out of
 * the database, and a match pointing at a row that is not there is skipped in
 * silence.
 */
export function seedManualMatches(db: Db, matches: Record<string, string | null>): number {
  const insert = db.prepare(
    `INSERT INTO playlists (id, channel_id, video_count, alive, next_refresh_at)
     VALUES (?, '${PLACEHOLDER_CHANNEL}', 0, 1, ?)
     ON CONFLICT(id) DO NOTHING`
  );

  let seeded = 0;
  db.transaction(() => {
    for (const [playlistId, courseId] of Object.entries(matches)) {
      if (!courseId) continue; // `null` means "this is not a course", not "fetch it"
      // Due immediately: it is bound to a course already, so it is the most
      // valuable metadata the next run can buy.
      if (!insert.run(playlistId, nowIso()).changes) continue;
      enqueue(db, 'videos', playlistId);
      seeded += 1;
    }
  })();

  return seeded;
}

/* ──────────────────────────  Playlist metadata  ────────────────────────── */

/** How many rows are examined for being due. Not a cap on the work itself. */
const SCAN_LIMIT = 5000;

/**
 * Refreshes playlist metadata 50 at a time. Popular playlists come round more
 * often — their numbers move, and they are the ones people actually sort by.
 *
 * `limit` caps how many playlists this run refreshes; the ones left over stay
 * due and are picked up by the next call, since `next_refresh_at` is what
 * decides due-ness and only the refreshed rows get a new one.
 *
 * Due-ness reads the same column the refresh writes. It used to be asked of
 * `stats_fetched_at`, which nothing here sets — that column is filled by the
 * video pass — so every playlist stayed due forever and each run re-bought
 * metadata it already had.
 */
export async function refreshPlaylistMetadata(
  db: Db,
  api: YoutubeClient,
  limit = Infinity
): Promise<{ refreshed: number; quotaExhausted: boolean; remaining: number }> {
  const popularCutoff = popularThreshold(db);

  const allDue = (
    db
      .prepare(
        // A playlist that has never had metadata is scanned first. Ordering by
        // views alone put it last — its view count is still null — and with
        // more playlists than the scan window, a hand-added one would fall
        // outside it every night and never be fetched at all.
        `SELECT id, views, video_count, videos_fetched_at, next_refresh_at FROM playlists
         WHERE alive = 1 ORDER BY (published_at IS NULL) DESC, views DESC LIMIT ?`
      )
      .all(SCAN_LIMIT) as Array<{
      id: string;
      views: number | null;
      video_count: number | null;
      videos_fetched_at: string | null;
      next_refresh_at: string | null;
    }>
  ).filter((row) => isPast(row.next_refresh_at));

  const due = allDue.slice(0, limit);
  const remaining = allDue.length - due.length;

  if (!due.length) return { refreshed: 0, quotaExhausted: false, remaining };

  const before = new Map(due.map((row) => [row.id, row]));
  // Popular playlists come round sooner: their numbers move, and they are the
  // ones people sort by. The tier is carried by the date this run writes.
  const nextRefreshFor = (id: string): string =>
    inDays(
      (before.get(id)?.views ?? 0) >= popularCutoff
        ? REFRESH_DAYS.statsPopular
        : REFRESH_DAYS.statsRegular
    );

  // The channel is written only when there is no real one yet. A playlist that
  // arrived by id — imported from a list, or named in an issue — has a
  // placeholder there, and without this it would keep it forever: nothing else
  // fills the column in, and the catalogue would show the playlist with no
  // university against it and no way to filter to it.
  const update = db.prepare(
    `UPDATE playlists SET title = ?, description = ?, video_count = ?, published_at = ?,
                          channel_id = CASE WHEN channel_id IS NULL OR channel_id IN ${PLACEHOLDER_CHANNELS_SQL}
                                            THEN ? ELSE channel_id END,
                          checked_at = ?, next_refresh_at = ?
     WHERE id = ?`
  );
  // Nothing but the title: `provider_id` is set by discovery from channels.yaml
  // and by hand in `overrides.channels`, and a channel met this way has neither.
  const learnChannel = db.prepare(
    `INSERT INTO channels (id, title) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`
  );
  const markDead = db.prepare(`UPDATE playlists SET alive = 0, checked_at = ? WHERE id = ?`);

  let refreshed = 0;
  for (const chunk of chunked(due.map((row) => row.id), 50)) {
    let items;
    try {
      items = await api.playlists(chunk);
    } catch (error) {
      if (error instanceof QuotaExceededError) return { refreshed, quotaExhausted: true, remaining };
      throw error;
    }

    const seen = new Set(items.map((item) => item.id));
    const write = db.transaction(() => {
      for (const item of items) {
        // Asked before the update writes the new count over the old one.
        const stale = videoListStale(before.get(item.id), item.contentDetails.itemCount);
        update.run(
          item.snippet.title,
          item.snippet.description ?? '',
          item.contentDetails.itemCount,
          item.snippet.publishedAt,
          item.snippet.channelId,
          nowIso(),
          nextRefreshFor(item.id),
          item.id
        );
        learnChannel.run(item.snippet.channelId, item.snippet.channelTitle);
        // Only when the item count moved — the comment used to say as much
        // while the code queued every playlist it looked at, which handed the
        // expensive step the whole catalogue on every metadata run.
        if (stale) enqueue(db, 'videos', item.id);
      }
      // Anything the API did not return in a batch it was asked for is gone.
      for (const id of chunk) if (!seen.has(id)) markDead.run(nowIso(), id);
    });
    write();
    refreshed += items.length;
  }

  return { refreshed, quotaExhausted: false, remaining };
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

/**
 * How the video queue should be ordered, worked out from the two things the
 * queue cannot see: the hand decisions in `overrides.yaml`, and the rule that
 * recognises a title as support material rather than a course.
 *
 * Both ends matter. A playlist someone bound by hand is the one the crawl most
 * owes a duration to, and a playlist someone refused — or one whose title says
 * «seminar series» — is never shown however much is spent on it. The refusals
 * are also the expensive end: topic bins run to hundreds of videos apiece.
 */
export function videoQueueTiers(
  db: Db,
  overrides: Record<string, string | null>
): { first: string[]; last: string[] } {
  const first: string[] = [];
  const last: string[] = [];
  for (const [playlistId, courseId] of Object.entries(overrides)) {
    (courseId === null ? last : first).push(playlistId);
  }

  const queued = db
    .prepare(
      `SELECT p.id, p.title FROM playlists p
       JOIN jobs j ON j.type = 'videos' AND j.target = p.id AND j.status = 'pending'
       WHERE p.alive = 1`
    )
    .all() as Array<{ id: string; title: string }>;
  for (const row of queued) {
    if (cleanSegments(row.title).some(isNotACourse)) last.push(row.id);
  }

  return { first, last };
}

/* ────────────────────────────────  Liveness  ───────────────────────────── */

/**
 * `limit` caps how many playlists this run checks. `checked_at` moves only for
 * the ones actually asked about, so the next call continues with the rest.
 */
export async function checkLiveness(
  db: Db,
  api: YoutubeClient,
  limit = Infinity
): Promise<{ checked: number; dead: number; quotaExhausted: boolean; remaining: number }> {
  const allDue = (
    db
      .prepare(`SELECT id, checked_at FROM playlists WHERE alive = 1`)
      .all() as Array<{ id: string; checked_at: string | null }>
  )
    .filter((row) => isDue(row.checked_at, REFRESH_DAYS.liveness))
    .map((row) => row.id);

  const due = allDue.slice(0, limit);
  const remaining = allDue.length - due.length;

  if (!due.length) return { checked: 0, dead: 0, quotaExhausted: false, remaining };

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
        return { checked, dead, quotaExhausted: true, remaining };
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

  return { checked, dead, quotaExhausted: false, remaining };
}
