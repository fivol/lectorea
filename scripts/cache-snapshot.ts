import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { nowIso, paths } from './lib/config.js';
import {
  dbExists,
  dbHasMaterial,
  snapshotStamp,
  workSince,
  writeSnapshotStamp,
} from './lib/db.js';

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
 *   pnpm cache:restore     the release → data/cache.db, when the release is ahead
 *
 * **The release is the source of truth, and the newer generation wins.** That
 * is one rule and it replaced three broken ones. `restore` used to ask "is
 * there anything here already" and stand aside if there was, which meant every
 * machine kept whatever it happened to hold: a snapshot published from a laptop
 * was picked up by nobody, the nightly job crawled on top of its own Actions
 * cache, published over the laptop's work, and the evening was gone by morning.
 * So each copy carries the moment its lineage was published (`snapshotStamp` in
 * `lib/db.ts`), and that is what gets compared.
 *
 * Which keeps `restore` safe to run unconditionally on every job — the point of
 * the old rule — while making it mean something: a job takes the release when
 * the release is ahead of it, and otherwise carries on with what it has.
 *
 * With one asymmetry, in `shouldRestore`: **a laptop may refuse the release, a
 * runner may not.** Every refusal there means "there is crawling on this disk
 * and nowhere else", which is a real thing to protect on somebody's machine and
 * cannot be true in CI — `refresh` publishes before it saves, so a runner's
 * cache is always either the published generation or a copy of one. Letting CI
 * refuse bought nothing and cost a site that silently stopped updating.
 */

const TAG = 'data-cache';
const ASSET = 'cache.db.gz';

/**
 * The generation, as a few dozen bytes beside the 65 MB.
 *
 * Deciding whether to restore has to be cheaper than restoring, or every job
 * that runs the check pays the transfer to find out it did not need it. The
 * asset's own `updatedAt` is the wrong clock — it is when the upload finished,
 * not the moment the snapshot was cut, so a machine would find its own publish
 * looking newer than itself and download what it had just sent.
 */
const STAMP_ASSET = 'cache.db.stamp';

type Stamp = { published_at: string; playlists: number; videos: number };

/**
 * `raw_responses` is almost the whole of the cache and none of the value.
 *
 * It is every API body kept verbatim, so a parser can be fixed and re-run
 * without spending the quota again — worth its weight on the machine that
 * crawled, worth nothing to a CI job that only refreshes and builds. Nothing in
 * the nightly chain reads it (only `11-mine` and `stats` do, both local), so it
 * is left at home and the snapshot is a hundredth of the size.
 */
const HEAVY = 'raw_responses';

/**
 * Tables a restore **merges** instead of replacing, because their rows are
 * judgements rather than crawl state.
 *
 * Everything else here follows one rule — the release is the source of truth —
 * and for the crawl that is right: a playlist's video count is a fact about
 * YouTube, so the newest copy of it wins and the older one has nothing to add.
 * A judgement is not that. `verdicts` is a reader's answer about one binding
 * and `ownership` is a unit spent asking who filmed it; both are keyed per
 * playlist, both accumulate wherever the asking happened, and **two copies
 * holding different rows is the normal state, not a conflict.** The nightly job
 * judges what it crawled, a laptop clears a backlog, and neither has any claim
 * on the other's rows.
 *
 * Replacing them cost 682 ownership probes on 2026-08-16: they were written in
 * the morning, a restore later that day deleted the table and put the release's
 * eight rows in its place, and nothing said so. The 5469 verdicts behind the
 * whole catalogue were one `make pull` from going the same way — 35 minutes of
 * subagents and 3.3M tokens that no quota buys back.
 *
 * So the merge is newest-per-key and never deletes. It needs a single-column
 * primary key and a `checked_at`, which is the shape all three tables have and
 * the shape the next one should copy. `searches` is the third and the same
 * argument: a query costs 100 units, the record of having asked it is the only
 * thing that stops the next hunt buying the same first page, and a laptop's
 * hunt and the nightly job's have no claim on each other's questions.
 */
const MERGED = new Set(['verdicts', 'ownership', 'searches']);

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
  const stampFile = path.join(workDir, STAMP_ASSET);

  try {
    const counts = copyInto(snapshot, withRaw);
    for (const [table, rows] of counts) console.log(`  ${table.padEnd(16)} ${rows}`);

    // The generation this publish creates. It goes into the snapshot itself, so
    // that whoever restores it knows what they are descended from, and into the
    // sidecar, so that deciding not to restore costs one small download.
    const rows = new Map(counts);
    const stamp: Stamp = {
      published_at: nowIso(),
      playlists: rows.get('playlists') ?? 0,
      videos: rows.get('videos') ?? 0,
    };
    writeSnapshotStamp(snapshot, stamp.published_at);
    fs.writeFileSync(stampFile, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');

    const previous = fetchStamp();
    if (previous) console.log(`· replacing the snapshot of ${previous.published_at}`);

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
    if (!gh(['release', 'upload', TAG, archive, stampFile, '--clobber'])) {
      console.error('The upload failed — nothing was published and this cache is unchanged.');
      process.exit(1);
    }

    // Only now, and this order is the whole of the failure handling. The stamp
    // is a claim about what is on the release; written before the upload, a
    // failed one would leave this machine claiming a generation that does not
    // exist, and every other copy would defer to a snapshot nobody can fetch.
    writeSnapshotStamp(paths.cacheDb, stamp.published_at);
    console.log(`✓ published as ${stamp.published_at} — pnpm cache:restore takes it from here`);
  } finally {
    if (!dryRun) fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Table by table into a fresh database, rather than a copy of the file.
 *
 * `VACUUM INTO` would want a copy of the whole cache in free disk to produce a
 * 240 MB result, and the whole point of the exercise is that most of those
 * gigabytes are not coming. Copying the schema out of `sqlite_master` keeps this honest as the
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
  const local = snapshotStamp();

  if (!force && !shouldRestore(local)) return;

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectorea-cache-'));
  const archive = path.join(workDir, ASSET);
  const incoming = path.join(workDir, 'incoming.db');

  try {
    // A fork has no snapshot of its own, and the build is written to survive a
    // catalogue without playlists. Missing is therefore a state, not a failure.
    if (!gh(['release', 'download', TAG, '--pattern', ASSET, '--dir', workDir, '--clobber'])) {
      console.log(`· no ${TAG} release to restore from — carrying on without a crawl`);
      return;
    }

    console.log(`· ${mb(fs.statSync(archive).size)} downloaded, unpacking`);
    await pipeline(fs.createReadStream(archive), zlib.createGunzip(), fs.createWriteStream(incoming));

    // Nothing here yet: take the file whole, which is the cheap path and the
    // one every fresh machine and every CI job walks.
    if (!dbHasMaterial()) {
      // The write-ahead log belongs to the database being replaced. Left behind
      // it would be replayed into the new file, which is a different database.
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(paths.cacheDb + suffix, { force: true });
      fs.mkdirSync(path.dirname(paths.cacheDb), { recursive: true });
      // A rename across filesystems is an error rather than a copy, and a
      // temporary directory is not promised to be on the same one.
      try {
        fs.renameSync(incoming, paths.cacheDb);
      } catch {
        fs.copyFileSync(incoming, paths.cacheDb);
      }
      if (!dbExists()) {
        console.error('The restored file is not a crawl cache — refusing to leave it in place.');
        fs.rmSync(paths.cacheDb, { force: true });
        process.exit(1);
      }
      report();
      return;
    }

    swapInto(incoming);
    report();
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Whether the release is ahead of this copy — and, when it is not, why.
 *
 * Every branch here ends in a sentence somebody can act on, because the wrong
 * answer is expensive in both directions: refusing costs a stale catalogue that
 * looks fine, and accepting costs an evening of crawling that existed in one
 * place.
 */
function shouldRestore(local: string | null): boolean {
  if (!dbHasMaterial()) return true;

  const remote = fetchStamp();
  if (!remote) {
    console.log('· the release has no snapshot to compare against — leaving the local crawl alone');
    return false;
  }

  // Asked before anything else that could refuse, so that the common case —
  // this copy is already the published generation — costs the sidecar and not
  // the snapshot. Guarded on `local` because a copy with no generation at all
  // cannot be up to date with anything.
  if (local && remote.published_at <= local) {
    console.log(`· up to date — this cache and the release are both ${local}`);
    return false;
  }

  // Past here the release is ahead, or this copy has no generation to compare —
  // and the two refusals below both mean "there is work on this disk and
  // nowhere else". On a runner there is no such work. `refresh` publishes
  // before it saves the Actions cache, so anything CI has crawled is already on
  // the release, and everything else it holds is a copy of something. So the
  // release is simply the truth, and CI takes it.
  //
  // Without this the failure is silent, which is what makes it worth a branch:
  // an Actions cache saved before the publish that would have stamped it (as
  // the one from 2026-08-13 was) sends every later deploy down the `!local`
  // refusal. The deploy still succeeds, the site still serves, and the
  // catalogue quietly stops moving — it took comparing `meta.json` against the
  // release stamp by hand to notice 858 playlists were missing.
  //
  // The trade is deliberate: an unstamped runner cache that had crawled beyond
  // the release loses that crawl. Publish-before-save is what stops that state
  // from arising, and a runner's evening is worth less than a stale site.
  if (process.env.CI) {
    console.log(`· CI holds nothing of its own — taking the release (${remote.published_at})`);
    return true;
  }

  if (!local) {
    // Crawled here from nothing, and never published: there is no generation to
    // compare, and the material exists on this disk and nowhere else.
    console.log(
      `· this cache has never been in a snapshot, so nothing says which is newer.\n` +
        `  pnpm cache:publish to make it the one everybody follows, or --force to replace it.`
    );
    return false;
  }

  const ahead = workSince(local);
  if (ahead) {
    console.log(
      `· the release is newer (${remote.published_at}) but this cache has crawled since\n` +
        `  it was published — the newest local work is ${ahead}, and it is nowhere else.\n` +
        `  pnpm cache:publish to send it up first, or --force to throw it away.`
    );
    return false;
  }

  console.log(`· the release is ahead: ${local} here, ${remote.published_at} there`);
  return true;
}

/**
 * The generation on the release, or null when there is not one to read.
 *
 * Its own temporary directory rather than a caller's: `publish` asks what it is
 * about to replace while its own sidecar of the same name is already written,
 * and downloading into that directory would overwrite it with the answer.
 */
function fetchStamp(): Stamp | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectorea-stamp-'));
  try {
    if (!quiet(['release', 'download', TAG, '--pattern', STAMP_ASSET, '--dir', dir, '--clobber'])) {
      return null;
    }
    return JSON.parse(fs.readFileSync(path.join(dir, STAMP_ASSET), 'utf8')) as Stamp;
  } catch {
    // A release published before the stamp existed, or an asset that is not the
    // JSON it should be. Either way there is no generation here to trust.
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Everything the snapshot carries, over everything this cache holds — except
 * `raw_responses`, which stays.
 *
 * Replacing the file would be simpler and would throw away the reason the raw
 * bodies are kept at all. They are the API answers this machine paid for,
 * they are what makes "fix the parser and re-run" possible instead of "fix the
 * parser and wait for tomorrow", and they are deliberately left out of the
 * snapshot — so a plain file swap silently costs a laptop its archive every
 * time it pulls. Swapping table by table costs a copy of the 190 MB that did
 * travel, and keeps the rest.
 *
 * Columns are intersected rather than assumed: a cache last opened before a
 * migration has fewer of them, and `SELECT *` would line the wrong ones up.
 *
 * The exception is `MERGED`, where the two copies are peers rather than an old
 * and a new one: those tables are unioned by key, newest `checked_at` winning,
 * and no row of this machine's is deleted.
 */
function swapInto(incoming: string): void {
  const db = new Database(paths.cacheDb);
  try {
    db.pragma('journal_mode = WAL');
    db.prepare(`ATTACH DATABASE ? AS snap`).run(incoming);

    const tables = (
      db
        .prepare(
          `SELECT name, sql FROM snap.sqlite_master
           WHERE type = 'table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`
        )
        .all() as Array<{ name: string; sql: string }>
    ).filter((table) => table.name !== HEAVY);

    const info = (schema: string, table: string) =>
      db.prepare(`PRAGMA ${schema}.table_info("${table}")`).all() as Array<{
        name: string;
        pk: number;
      }>;
    const columns = (schema: string, table: string): string[] =>
      info(schema, table).map((column) => column.name);

    const merged: string[] = [];

    db.transaction(() => {
      for (const table of tables) {
        const theirs = columns('snap', table.name);
        let mine = columns('main', table.name);
        if (!mine.length) {
          db.exec(table.sql);
          mine = theirs;
        }
        const shared = theirs.filter((column) => mine.includes(column));
        const list = shared.map((column) => `"${column}"`).join(', ');

        if (MERGED.has(table.name)) {
          merged.push(table.name);
          const before = countRows(db, table.name);
          const key = info('main', table.name).filter((column) => column.pk).map((c) => c.name);
          // Both conditions are on the shape `MERGED` is documented to require.
          // Falling through to the replace would be the silent version of this,
          // and the silent version is what cost the 682 probes.
          if (key.length !== 1 || !shared.includes('checked_at')) {
            throw new Error(
              `${table.name} is listed as merged but has no single-column key with a checked_at`
            );
          }
          const set = shared
            .filter((column) => column !== key[0])
            .map((column) => `"${column}" = excluded."${column}"`)
            .join(', ');
          // `WHERE true` is not decoration: without it SQLite reads the ON
          // CONFLICT as part of the SELECT and refuses the statement.
          db.exec(
            `INSERT INTO main."${table.name}" AS old (${list})
             SELECT ${list} FROM snap."${table.name}" WHERE true
             ON CONFLICT("${key[0]}") DO UPDATE SET ${set}
               WHERE excluded."checked_at" > old."checked_at"`
          );
          console.log(
            `· ${table.name}: ${before} here + ${countRows(db, table.name) - before} from the release, ` +
              `kept rather than replaced`
          );
          continue;
        }

        db.exec(`DELETE FROM main."${table.name}"`);
        db.exec(`INSERT INTO main."${table.name}" (${list}) SELECT ${list} FROM snap."${table.name}"`);
      }
    })();

    db.exec(`DETACH DATABASE snap`);

    // The snapshot has no `raw_responses` table at all, so a cache restored
    // from one has none either until `openDb` next runs. Absent is a normal
    // state here, not a broken database.
    const hasRaw = db
      .prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table' AND name = ?`)
      .get(HEAVY);
    if (hasRaw) {
      const kept = db.prepare(`SELECT COUNT(*) AS rows FROM "${HEAVY}"`).get() as { rows: number };
      if (kept.rows) console.log(`· ${kept.rows} raw API bodies kept — they are this machine's own`);
    }
  } finally {
    db.close();
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

function countRows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS rows FROM main."${table}"`).get() as { rows: number }).rows;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
