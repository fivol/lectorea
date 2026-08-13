import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { paths, nowIso, env } from './config.js';

/**
 * `data/cache.db` is not the source of truth — it is the cache and the working
 * memory between runs. Sources live in YAML; anything here can be rebuilt by
 * spending quota again.
 */

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  title TEXT,
  provider_id TEXT,
  uploads_playlist_id TEXT,
  handle TEXT,
  last_discovered_at TEXT,
  subscribers INTEGER,
  subscribers_hidden INTEGER DEFAULT 0,
  stats_fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  title TEXT,
  description TEXT,
  video_count INTEGER,
  published_at TEXT,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  lang TEXT,
  captions TEXT,
  total_seconds INTEGER,
  median_seconds INTEGER,
  last_video_at TEXT,
  stats_fetched_at TEXT,
  videos_fetched_at TEXT,
  alive INTEGER DEFAULT 1,
  checked_at TEXT,
  next_refresh_at TEXT,
  list_playable INTEGER,
  list_checked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_playlists_channel ON playlists(channel_id);
CREATE INDEX IF NOT EXISTS idx_playlists_refresh ON playlists(next_refresh_at);

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  playlist_id TEXT,
  position INTEGER,
  title TEXT,
  duration_seconds INTEGER,
  published_at TEXT,
  views INTEGER,
  likes INTEGER
);
CREATE INDEX IF NOT EXISTS idx_videos_playlist ON videos(playlist_id, position);

CREATE TABLE IF NOT EXISTS raw_responses (
  id INTEGER PRIMARY KEY,
  endpoint TEXT,
  request_key TEXT,
  body TEXT,
  fetched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_raw_key ON raw_responses(endpoint, request_key);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  type TEXT,
  target TEXT,
  status TEXT,
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  next_retry_at TEXT,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_unique ON jobs(type, target);
CREATE INDEX IF NOT EXISTS idx_jobs_pick ON jobs(status, next_retry_at);

CREATE TABLE IF NOT EXISTS matches (
  playlist_id TEXT PRIMARY KEY,
  course_id TEXT,
  confidence REAL,
  method TEXT,
  reviewed INTEGER DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS quota (
  date TEXT,
  key TEXT,
  spent INTEGER DEFAULT 0,
  PRIMARY KEY (date, key)
);
`;

export function openDb(options: { readonly?: boolean } = {}): Db {
  fs.mkdirSync(path.dirname(paths.cacheDb), { recursive: true });
  const db = new Database(paths.cacheDb, { readonly: options.readonly ?? false });
  db.pragma('journal_mode = WAL');
  if (!options.readonly) {
    db.exec(SCHEMA);
    migrateQuotaPerKey(db);
    addColumns(db);
  }
  return db;
}

/**
 * Columns added to a table that already exists on disk.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op on a 2 GB cache, so a new field in
 * SCHEMA would be silently missing on every machine that has crawled before.
 * Adding a nullable column is the one schema change SQLite does instantly and
 * without rewriting the table, so the list is cheap to walk on every open.
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; type: string }> = [
  { table: 'channels', column: 'subscribers', type: 'INTEGER' },
  { table: 'channels', column: 'subscribers_hidden', type: 'INTEGER DEFAULT 0' },
  { table: 'channels', column: 'stats_fetched_at', type: 'TEXT' },
  { table: 'playlists', column: 'last_video_at', type: 'TEXT' },
  { table: 'playlists', column: 'list_playable', type: 'INTEGER' },
  { table: 'playlists', column: 'list_checked_at', type: 'TEXT' },
];

function addColumns(db: Db): void {
  for (const { table, column, type } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.length || columns.some((existing) => existing.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * The ledger used to be one row a day, from when there was one key. A key from
 * another project is another 10 000 units, so the day is now counted per key.
 *
 * Everything already written was spent on the first key, and that is where it
 * goes. On a machine with no key configured there is nothing to attribute it
 * to and it lands under `legacy` — harmless, because a machine that cannot
 * crawl cannot misread the ledger either, and a mislabelled row only ever
 * costs one 403 that rotation absorbs.
 */
function migrateQuotaPerKey(db: Db): void {
  const columns = db.prepare(`PRAGMA table_info(quota)`).all() as Array<{ name: string }>;
  if (columns.length === 0 || columns.some((column) => column.name === 'key')) return;

  const owner = env.youtubeKeys[0] ? keyId(env.youtubeKeys[0]) : 'legacy';
  db.exec(`ALTER TABLE quota RENAME TO quota_by_day`);
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO quota (date, key, spent) SELECT date, ?, spent FROM quota_by_day`).run(
    owner
  );
  db.exec(`DROP TABLE quota_by_day`);
}

/**
 * True when there is a crawl worth reading. The file existing is not enough:
 * a run that died before it opened the database for writing leaves an empty
 * one behind, and a build that trusts the filename then dies on the first
 * query instead of falling back to a catalogue without playlists.
 */
export function dbExists(): boolean {
  if (!fs.existsSync(paths.cacheDb)) return false;
  try {
    const db = new Database(paths.cacheDb, { readonly: true });
    try {
      const table = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'playlists'`)
        .get();
      return table !== undefined;
    } finally {
      db.close();
    }
  } catch {
    // Not a readable SQLite file at all — same answer, for the same reason.
    return false;
  }
}

/**
 * True when the crawl cache holds material, not merely a schema.
 *
 * The distinction is what the nightly job has to decide by, and it is not the
 * one above. `openDb` creates every table before the first request goes out, so
 * a run that dies on a missing API key still leaves a complete and completely
 * empty database — which `dbExists` calls a crawl, because the tables are all
 * there. Saved to the Actions cache under a newer key, that empty file wins the
 * `cache-db-` prefix race against the last good one, and the deploy publishes a
 * catalogue with no playlists in it.
 *
 * Which is what happened every night from 2026-08-08: `refresh` red, `deploy`
 * green, and `coverage 0.0% (0/186)` on the live site for five days, because
 * nothing in the chain treats an empty catalogue as a failure.
 */
export function dbHasMaterial(): boolean {
  if (!dbExists()) return false;
  const db = new Database(paths.cacheDb, { readonly: true });
  try {
    const row = db.prepare(`SELECT EXISTS (SELECT 1 FROM playlists) AS any`).get() as {
      any: number;
    };
    return row.any === 1;
  } finally {
    db.close();
  }
}

/* ─────────────────────────────  Raw responses  ─────────────────────────── */

/**
 * Every API body is kept verbatim. With a daily quota this is the difference
 * between "fix the parser and re-run" and "fix the parser and wait until
 * tomorrow" — it is not an archival luxury.
 */
export function saveRaw(db: Db, endpoint: string, requestKey: string, body: unknown): void {
  db.prepare(
    `INSERT INTO raw_responses (endpoint, request_key, body, fetched_at) VALUES (?, ?, ?, ?)`
  ).run(endpoint, requestKey, JSON.stringify(body), nowIso());
}

export function readRaw<T>(db: Db, endpoint: string, requestKey: string): T | null {
  const row = db
    .prepare(
      `SELECT body FROM raw_responses WHERE endpoint = ? AND request_key = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(endpoint, requestKey) as { body: string } | undefined;
  return row ? (JSON.parse(row.body) as T) : null;
}

/* ────────────────────────────────  Quota  ──────────────────────────────── */

/**
 * Quota resets at midnight Pacific time, which is what this date key tracks.
 *
 * Formatted straight to `YYYY-MM-DD` in the Pacific zone. Reading the wall
 * clock back through `new Date(…)` and `toISOString()` looks equivalent and is
 * not: the Pacific time is reparsed as *local* time and then converted to UTC,
 * so from a zone ahead of UTC the first hours after the reset still key to
 * yesterday — the crawler would read yesterday's spend and refuse to start at
 * exactly the hour the nightly job runs.
 */
const PACIFIC_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function quotaDateKey(now = new Date()): string {
  return PACIFIC_DAY.format(now);
}

/**
 * A key's name in the ledger: eight hex characters of its digest, which is not
 * the key and cannot be turned back into it.
 *
 * Identity follows the value rather than the slot it sits in, so swapping two
 * keys around in `.env` does not hand one of them the other's spending — the
 * one mistake here that would quietly overdraw a project. Replacing a key
 * starts a fresh row, and if the project behind it is in fact spent, the API
 * says so on the first call and rotation writes it off.
 */
export function keyId(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

export function spentToday(db: Db, key: string): number {
  const row = db
    .prepare(`SELECT spent FROM quota WHERE date = ? AND key = ?`)
    .get(quotaDateKey(), key) as { spent: number } | undefined;
  return row?.spent ?? 0;
}

/** Every key's spending together — what a run reports, and what a human reads. */
export function spentTodayTotal(db: Db): number {
  const row = db
    .prepare(`SELECT COALESCE(sum(spent), 0) AS spent FROM quota WHERE date = ?`)
    .get(quotaDateKey()) as { spent: number };
  return row.spent;
}

export function spendQuota(db: Db, key: string, units: number): number {
  db.prepare(
    `INSERT INTO quota (date, key, spent) VALUES (?, ?, ?)
     ON CONFLICT(date, key) DO UPDATE SET spent = spent + excluded.spent`
  ).run(quotaDateKey(), key, units);
  return spentToday(db, key);
}

/**
 * Write off the rest of a key's day, after the API answered `quotaExceeded` on
 * a key the ledger still thought had room. The ledger is only this machine's
 * memory of the day — a fresh clone, or a project CI has been spending on,
 * both look untouched here — so the 403 is the fact and this records it.
 */
export function exhaustKey(db: Db, key: string, ceiling: number): void {
  db.prepare(
    `INSERT INTO quota (date, key, spent) VALUES (?, ?, ?)
     ON CONFLICT(date, key) DO UPDATE SET spent = max(spent, excluded.spent)`
  ).run(quotaDateKey(), key, ceiling);
}

/* ───────────────────────────────  Reading  ─────────────────────────────── */

export type PlaylistRow = {
  id: string;
  channel_id: string;
  title: string;
  description: string | null;
  video_count: number;
  published_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  lang: string | null;
  captions: string | null;
  total_seconds: number | null;
  median_seconds: number | null;
  last_video_at: string | null;
  stats_fetched_at: string | null;
  alive: number;
  checked_at: string | null;
  /**
   * Whether YouTube's player will accept this playlist as `list=`.
   *
   * Null until checked, and read as "yes" while it is — the overwhelming
   * majority work, and a shard is better slightly optimistic than withholding
   * the next-lecture rail from everything it has not got round to.
   */
  list_playable: number | null;
  list_checked_at: string | null;
};

export type VideoRow = {
  id: string;
  playlist_id: string;
  position: number;
  title: string;
  duration_seconds: number | null;
  /** Both only read by the build, when it measures the shape of the view curve. */
  views?: number | null;
  published_at?: string | null;
};

export type MatchRow = {
  playlist_id: string;
  course_id: string | null;
  confidence: number;
  method: string;
  reviewed: number;
};

/**
 * How sure an automatic binding has to be before the catalogue shows it.
 *
 * One number, shared: the matcher decides what to hand to a human by it, the
 * build decides what to publish by it, and the queue decides what is worth
 * spending quota on by it. Three copies of `0.75` would drift.
 */
export const MATCH_THRESHOLD = 0.75;

/** A binding the catalogue can show: reviewed by hand, or confident enough. */
export function isBindingConfident(match: Pick<MatchRow, 'confidence' | 'reviewed'>): boolean {
  return match.reviewed === 1 || match.confidence >= MATCH_THRESHOLD;
}

export type ChannelRow = {
  id: string;
  title: string | null;
  provider_id: string | null;
  uploads_playlist_id: string | null;
  handle: string | null;
  last_discovered_at: string | null;
  /** Null until `data:subscribers` has run, and when the channel hides the count. */
  subscribers: number | null;
  subscribers_hidden: number | null;
  stats_fetched_at: string | null;
};
