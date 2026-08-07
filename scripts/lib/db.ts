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

export function dbExists(): boolean {
  return fs.existsSync(paths.cacheDb);
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

/** Quota resets at midnight Pacific time, which is what this date key tracks. */
export function quotaDateKey(now = new Date()): string {
  const pacific = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
  );
  return pacific.toISOString().slice(0, 10);
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

export type ChannelRow = {
  id: string;
  title: string | null;
  provider_id: string | null;
  uploads_playlist_id: string | null;
  handle: string | null;
  last_discovered_at: string | null;
};
