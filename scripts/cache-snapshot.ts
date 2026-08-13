import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { paths } from './lib/config.js';
import { dbExists, dbHasMaterial } from './lib/db.js';

/**
 * The crawl cache, carried between machines through a release asset.
 *
 * `cache.db` is rebuildable in principle and unaffordable in practice: the
 * catalogue behind the live site is tens of thousands of playlists and hundreds
 * of thousands of videos, which is a week of somebody's daily quota. The
 * Actions cache is the wrong place to keep that safe — it evicts after seven
 * idle days, a run that dies early can overwrite it, and nothing outside CI can
 * write to it at all, so a laptop that has crawled has no way to hand the work
 * over.
 *
 * A release asset can be written from anywhere, replaced in place, and read by
 * CI without a token of its own. So it holds the snapshot, and the Actions
 * cache stays what it was: the working copy between nightly runs.
 *
 *   pnpm cache:publish     local cache.db → the `data-cache` release
 *   pnpm cache:restore     the release → data/cache.db, when there is no crawl
 *
 * `restore` is a no-op when the cache already holds material, which is what
 * makes it safe to run on every job: the nightly Actions cache stays in charge
 * and the snapshot only fills the hole it leaves behind.
 */

const TAG = 'data-cache';
const ASSET = 'cache.db.gz';

/**
 * `raw_responses` is 3.5 of the 3.6 GB and none of the value.
 *
 * It is every API body kept verbatim, so a parser can be fixed and re-run
 * without spending the quota again — worth its weight on the machine that
 * crawled, worth nothing to a CI job that only refreshes and builds. Nothing in
 * the nightly chain reads it (only `11-mine` and `stats` do, both local), so it
 * is left at home and the snapshot is a hundredth of the size.
 */
const HEAVY = 'raw_responses';

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'publish') return publish();
  if (command === 'restore') return restore();
  console.error('Usage: tsx scripts/cache-snapshot.ts publish|restore');
  process.exit(1);
}

/* ────────────────────────────────  Publish  ─────────────────────────────── */

async function publish(): Promise<void> {
  const withRaw = process.argv.includes('--with-raw');
  const dryRun = process.argv.includes('--dry-run');

  if (!dbHasMaterial()) {
    console.error(
      'data/cache.db holds no crawl worth publishing — run pnpm data:refresh first.'
    );
    process.exit(1);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectorea-cache-'));
  const snapshot = path.join(workDir, 'cache.db');
  const archive = path.join(workDir, ASSET);

  try {
    const counts = copyInto(snapshot, withRaw);
    for (const [table, rows] of counts) console.log(`  ${table.padEnd(16)} ${rows}`);

    console.log('· compressing');
    await pipeline(
      fs.createReadStream(snapshot),
      zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION }),
      fs.createWriteStream(archive)
    );
    console.log(
      `· ${mb(fs.statSync(paths.cacheDb).size)} on disk → ` +
        `${mb(fs.statSync(snapshot).size)} snapshot → ${mb(fs.statSync(archive).size)} uploaded`
    );

    if (dryRun) {
      console.log(`✓ dry run — the archive stays in ${archive}`);
      return;
    }

    ensureRelease();
    console.log(`· uploading to the ${TAG} release`);
    gh(['release', 'upload', TAG, archive, '--clobber']);
    console.log(`✓ published — CI restores it with pnpm cache:restore`);
  } finally {
    if (!dryRun) fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Table by table into a fresh database, rather than a copy of the file.
 *
 * `VACUUM INTO` would want 3.6 GB of free disk to produce a 240 MB result, and
 * the whole point of the exercise is that most of those gigabytes are not
 * coming. Copying the schema out of `sqlite_master` keeps this honest as the
 * schema grows: a table added to `lib/db.ts` lands in the snapshot without
 * anyone remembering to add it here.
 */
function copyInto(target: string, withRaw: boolean): Array<[string, number]> {
  const db = new Database(target);
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');
  db.prepare(`ATTACH DATABASE ? AS src`).run(paths.cacheDb);

  const objects = db
    .prepare(
      `SELECT name, type, sql, tbl_name FROM src.sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`
    )
    .all() as Array<{ name: string; type: string; sql: string; tbl_name: string }>;

  const keep = (table: string) => withRaw || table !== HEAVY;
  const tables = objects.filter((row) => row.type === 'table' && keep(row.name));
  const counts: Array<[string, number]> = [];

  for (const table of tables) db.exec(table.sql);

  // Rows first, indexes after: building an index once at the end beats
  // maintaining it across 800 000 inserts, and this runs on a laptop.
  db.transaction(() => {
    for (const table of tables) {
      db.exec(`INSERT INTO main."${table.name}" SELECT * FROM src."${table.name}"`);
      const row = db.prepare(`SELECT COUNT(*) AS rows FROM main."${table.name}"`).get() as {
        rows: number;
      };
      counts.push([table.name, row.rows]);
    }

    // A job the crawl was holding when it stopped. Left as `running` it belongs
    // to a process that no longer exists on a machine that is not this one, and
    // nothing would ever pick it up again.
    const revived = db.prepare(`UPDATE jobs SET status = 'pending' WHERE status = 'running'`).run();
    if (revived.changes) console.log(`· ${revived.changes} interrupted jobs handed back to pending`);
  })();

  for (const index of objects) {
    if (index.type !== 'index' || !keep(index.tbl_name)) continue;
    db.exec(index.sql);
  }

  db.close();
  return counts;
}

/**
 * The release the asset hangs on. Not a version of anything — a named shelf,
 * replaced in place, and marked `--latest=false` so it never shadows a real
 * release on the repository's front page.
 */
function ensureRelease(): void {
  if (quiet(['release', 'view', TAG])) return;
  console.log(`· creating the ${TAG} release`);
  gh([
    'release',
    'create',
    TAG,
    '--title',
    'Crawl cache snapshot',
    '--notes',
    'The crawl cache CI restores when the Actions cache has nothing. ' +
      'Replaced by `pnpm cache:publish`; raw API bodies are left out.',
    '--latest=false',
  ]);
}

/* ────────────────────────────────  Restore  ─────────────────────────────── */

async function restore(): Promise<void> {
  const force = process.argv.includes('--force');

  if (!force && dbHasMaterial()) {
    console.log('· the crawl cache already holds material — leaving it alone');
    return;
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectorea-cache-'));
  const archive = path.join(workDir, ASSET);

  try {
    // A fork has no snapshot of its own, and the build is written to survive a
    // catalogue without playlists. Missing is therefore a state, not a failure.
    if (!gh(['release', 'download', TAG, '--pattern', ASSET, '--dir', workDir, '--clobber'])) {
      console.log(`· no ${TAG} release to restore from — carrying on without a crawl`);
      return;
    }

    console.log(`· ${mb(fs.statSync(archive).size)} downloaded, unpacking`);
    // The write-ahead log belongs to the database being replaced. Left behind it
    // would be replayed into the new file, which is a different database.
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(paths.cacheDb + suffix, { force: true });
    fs.mkdirSync(path.dirname(paths.cacheDb), { recursive: true });
    await pipeline(
      fs.createReadStream(archive),
      zlib.createGunzip(),
      fs.createWriteStream(paths.cacheDb)
    );

    if (!dbExists()) {
      console.error('The restored file is not a crawl cache — refusing to leave it in place.');
      fs.rmSync(paths.cacheDb, { force: true });
      process.exit(1);
    }
    report();
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function report(): void {
  const db = new Database(paths.cacheDb, { readonly: true });
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS rows FROM "${table}"`).get() as { rows: number }).rows;
  console.log(
    `✓ restored ${mb(fs.statSync(paths.cacheDb).size)}: ${count('playlists')} playlists, ` +
      `${count('videos')} videos, ${count('matches')} matches`
  );
  db.close();
}

/* ──────────────────────────────────  gh  ───────────────────────────────── */

/** False when the command failed, which the caller reads as "not there". */
function gh(args: string[]): boolean {
  try {
    execFileSync('gh', args, { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

/** The same, for a question whose answer is the exit code and nothing else. */
function quiet(args: string[]): boolean {
  try {
    execFileSync('gh', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
