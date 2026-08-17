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
  refused INTEGER DEFAULT 0,
  updated_at TEXT
);

-- Who made the videos a playlist lists, from one page of playlistItems.
--
-- Kept because the answer costs a unit and never changes: a playlist does not
-- stop being somebody's bookmarks. Without this table the ownership step would
-- re-buy the same verdict every night, which is the whole of its price.
--
-- kind is one of own / mirror / collection, and only a collection is a refusal:
-- a mirror is a real course filed under the wrong channel, and throwing it away
-- would cost material that in 24 of 34 cases exists nowhere else here.
-- (No backticks in this comment: SCHEMA is a template literal, and one closes it.)
CREATE TABLE IF NOT EXISTS ownership (
  playlist_id TEXT PRIMARY KEY,
  sampled INTEGER,
  own_share REAL,
  kind TEXT,
  owner_id TEXT,
  owner_title TEXT,
  checked_at TEXT
);

-- The reading a model gave a binding the rules had already accepted.
--
-- The rule pass is a first sieve, not the answer: it reads a title and cannot
-- see that «Trigonometry 3 - PRECALCULUS 8» is one topic of a course, that
-- «Crash Course in Music History» is not contemporary history, or that «Love
-- Babbar DSA 450 Questions» is a problem set. A sample of 120 published
-- bindings on 2026-08-16 was ~12% wrong in exactly those three shapes, and all
-- three are visible in the title — which is what makes a reader the right
-- instrument for them, and playlistItems (see the ownership table) the right
-- one for the collections a title cannot betray.
--
-- verdict is one of ok / wrong-course / not-a-course / unsure. Only ok
-- publishes; wrong-course carries the course it should have been.
--
-- course_id is what the reader was answering *about*, and it is the difference
-- between a verdict and a permanent pass. A reader asked whether «Fluid
-- Mechanics» belongs under transport phenomena; when a keyword change later
-- moves that playlist to a fluid mechanics course, the old ok is not an answer
-- to the new question. Without the column the build would republish it under a
-- course no reader ever saw — silently, and precisely on the playlists a rule
-- change touched, which are the ones worth looking at.
-- (No backticks in this comment: SCHEMA is a template literal, and one closes it.)
CREATE TABLE IF NOT EXISTS verdicts (
  playlist_id TEXT PRIMARY KEY,
  verdict TEXT,
  course_id TEXT,
  suggested_course TEXT,
  note TEXT,
  model TEXT,
  checked_at TEXT
);

CREATE TABLE IF NOT EXISTS quota (
  date TEXT,
  key TEXT,
  spent INTEGER DEFAULT 0,
  PRIMARY KEY (date, key)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export function openDb(options: { readonly?: boolean } = {}): Db {
  fs.mkdirSync(path.dirname(paths.cacheDb), { recursive: true });
  const db = new Database(paths.cacheDb, { readonly: options.readonly ?? false });
  if (!options.readonly) {
    // The journal mode belongs to the file rather than to the connection, and
    // asking for it is itself a write. A reader gets away with that only while
    // the file is already in WAL — which the crawl's own copy always is, and a
    // snapshot restored from the release never is: `cache-snapshot` writes it
    // into a fresh database with the journal off. That was the whole of
    // "attempt to write a readonly database" — the build opens the cache to
    // read it and died setting a property it has no use for.
    db.pragma('journal_mode = WAL');
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
  { table: 'matches', column: 'refused', type: 'INTEGER DEFAULT 0' },
  { table: 'verdicts', column: 'course_id', type: 'TEXT' },
];

function addColumns(db: Db): void {
  for (const { table, column, type } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.length || columns.some((existing) => existing.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    if (table === 'verdicts' && column === 'course_id') backfillVerdictCourses(db);
  }
}

/**
 * What the 5469 verdicts written before the column existed were answering.
 *
 * Run once, in the same statement that adds the column, and that timing is the
 * whole argument for it: a verdict is written against whatever `matches` said
 * at the time, and at the moment the column appears nothing has re-matched
 * since — so the current binding *is* the question that was asked. A minute
 * later it stops being true, which is why this is not a repair somebody can run
 * whenever they think of it.
 *
 * Rows the copy on disk cannot account for stay null, and `resolveCourses`
 * reads a null as "no drift detectable" rather than as a refusal: taking 5469
 * confirmations away to be safe would empty the catalogue.
 */
function backfillVerdictCourses(db: Db): void {
  const filled = db
    .prepare(
      `UPDATE verdicts SET course_id = (SELECT course_id FROM matches WHERE playlist_id = verdicts.playlist_id)
        WHERE course_id IS NULL`
    )
    .run();
  if (filled.changes) console.log(`· ${filled.changes} verdicts stamped with the course they judged`);
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
 *
 * A row in `playlists` is not the line either, which is how it went on happening
 * after the first fix: `seedManualMatches` writes one per binding in
 * `overrides.yaml` before a single request goes out, so the database that dies
 * on a missing key has hundreds of them and not one title. What separates a
 * crawl from a stub is therefore what only the API can supply — a video, or a
 * playlist whose metadata came back.
 */
export function dbHasMaterial(): boolean {
  if (!dbExists()) return false;
  const db = new Database(paths.cacheDb, { readonly: true });
  try {
    const row = db
      .prepare(
        `SELECT (EXISTS (SELECT 1 FROM videos)
              OR EXISTS (SELECT 1 FROM playlists WHERE title IS NOT NULL)) AS any`
      )
      .get() as { any: number };
    return row.any === 1;
  } catch {
    // A database old enough to be missing a table the question is asked of has
    // nothing this codebase can read either.
    return false;
  } finally {
    db.close();
  }
}

/* ────────────────────────────  Which generation  ───────────────────────── */

/**
 * The crawl cache exists in three places at once — a laptop, the Actions cache,
 * the `data-cache` release — and until this stamp there was no way to ask which
 * of them was ahead. `restore` decided by "is there anything here at all", so
 * whatever a machine already held won, however old it was: a snapshot published
 * from a laptop was restored by nobody, the nightly job crawled on top of the
 * cache it happened to have, and published over it. The evening's work survived
 * exactly until the next cron.
 *
 * So every copy carries the moment its lineage was published, and `restore`
 * compares that rather than counting rows. The release is the source of truth;
 * the Actions cache and a laptop are working copies of some generation of it.
 *
 * Written only by `cache:publish`, and only after the upload has succeeded — a
 * stamp for a snapshot that is not on the release would make this machine look
 * newer than the thing it failed to become.
 */
const SNAPSHOT_STAMP = 'snapshot_published_at';

/**
 * Timestamps unpublished work writes. Anything later than the stamp is work
 * that exists on this disk and nowhere else.
 *
 * The last two are not crawling and belong here for the same reason the rest
 * do: **what makes work worth protecting is that it cannot be had again for
 * free, not that it came off the API.** A judgement is the expensive kind — a
 * verdict is a reader's pass over a title, an ownership row is a unit spent on
 * `playlistItems` — and while this list held only crawl columns a copy that had
 * spent an afternoon judging looked untouched, so `shouldRestore` cheerfully
 * took the release over it. That is half of how 682 ownership probes went; the
 * other half, and the belt to this braces, is `MERGED` in `cache-snapshot.ts`.
 */
const WORK_COLUMNS: Array<[table: string, column: string]> = [
  ['playlists', 'stats_fetched_at'],
  ['playlists', 'videos_fetched_at'],
  ['playlists', 'checked_at'],
  ['playlists', 'list_checked_at'],
  ['channels', 'last_discovered_at'],
  ['channels', 'stats_fetched_at'],
  ['matches', 'updated_at'],
  ['verdicts', 'checked_at'],
  ['ownership', 'checked_at'],
];

/** The publish this copy descends from, or null when it has never been in one. */
export function snapshotStamp(file: string = paths.cacheDb): string | null {
  if (!fs.existsSync(file)) return null;
  try {
    const db = new Database(file, { readonly: true });
    try {
      const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(SNAPSHOT_STAMP) as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    } finally {
      db.close();
    }
  } catch {
    // No `meta` table: a cache from before this existed, which is the same
    // answer — nothing here says which generation it is.
    return null;
  }
}

export function writeSnapshotStamp(file: string, stamp: string): void {
  const db = new Database(file);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
    db.prepare(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(SNAPSHOT_STAMP, stamp);
  } finally {
    db.close();
  }
}

/**
 * The newest crawling this copy has done since its lineage was published, or
 * null when it has done none.
 *
 * This is the difference between "you are behind" and "you are behind *and*
 * ahead", and only the second is a thing a person has to decide about. A
 * machine that restored a snapshot and then crawled all evening holds material
 * that exists nowhere else; taking a newer release over it would be the one
 * irreversible thing this whole mechanism can do.
 */
export function workSince(stamp: string | null): string | null {
  if (!stamp || !dbExists()) return null;
  const db = new Database(paths.cacheDb, { readonly: true });
  try {
    let newest: string | null = null;
    for (const [table, column] of WORK_COLUMNS) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!columns.some((existing) => existing.name === column)) continue;
      const row = db
        .prepare(`SELECT MAX(${column}) AS newest FROM ${table} WHERE ${column} > ?`)
        .get(stamp) as { newest: string | null };
      if (row.newest && (!newest || row.newest > newest)) newest = row.newest;
    }
    return newest;
  } catch {
    return null;
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
/**
 * A reader's answer about a binding the rules already accepted.
 *
 * Only `ok` publishes. `wrong-course` publishes under `suggested_course`
 * instead; `not-a-course` and `unsure` keep the playlist out. A row that is
 * absent has not been read yet — `08-build.ts` treats that as "not confirmed",
 * never as "fine".
 */
export type VerdictRow = {
  playlist_id: string;
  verdict: 'ok' | 'wrong-course' | 'not-a-course' | 'unsure';
  /** The binding that was judged. Null on rows written before the column. */
  course_id: string | null;
  suggested_course: string | null;
  note: string | null;
  model: string | null;
  checked_at: string | null;
};

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
