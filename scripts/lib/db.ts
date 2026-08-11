import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { paths, nowIso } from './config.js';

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
  last_discovered_at TEXT
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
  stats_fetched_at TEXT,
  videos_fetched_at TEXT,
  alive INTEGER DEFAULT 1,
  checked_at TEXT,
  next_refresh_at TEXT
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
  date TEXT PRIMARY KEY,
  spent INTEGER DEFAULT 0
);
`;

export function openDb(options: { readonly?: boolean } = {}): Db {
  fs.mkdirSync(path.dirname(paths.cacheDb), { recursive: true });
  const db = new Database(paths.cacheDb, { readonly: options.readonly ?? false });
  db.pragma('journal_mode = WAL');
  if (!options.readonly) db.exec(SCHEMA);
  return db;
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

export function spentToday(db: Db): number {
  const row = db.prepare(`SELECT spent FROM quota WHERE date = ?`).get(quotaDateKey()) as
    | { spent: number }
    | undefined;
  return row?.spent ?? 0;
}

export function spendQuota(db: Db, units: number): number {
  const date = quotaDateKey();
  db.prepare(
    `INSERT INTO quota (date, spent) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET spent = spent + excluded.spent`
  ).run(date, units);
  return spentToday(db);
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
  stats_fetched_at: string | null;
  alive: number;
  checked_at: string | null;
};

export type VideoRow = {
  id: string;
  playlist_id: string;
  position: number;
  title: string;
  duration_seconds: number | null;
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
};
