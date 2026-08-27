import fs from 'node:fs';
import Database from 'better-sqlite3';
import { paths } from './lib/config.js';
import { MINED_THROUGH, getMeta, setMeta } from './lib/db.js';
import {
  BODIES_KEPT_FOREVER,
  BODY_RETENTION_DAYS,
  restripStored,
  retentionCutoff,
} from './lib/raw.js';
import { reportRunError } from './lib/exit.js';

/**
 * Keeps `raw_responses` bounded, so a scheduled harvest cannot fill the disk.
 *
 * The archive is why a parser bug costs an afternoon instead of a day of quota,
 * and left to itself it costs the machine instead: 28.2 GB of a 32 GB cache on
 * 2026-08-27, sixteen days in, 1.8 GB a day, 14 GB of disk left. The policy it
 * enforces — which bodies expire, which never do, what is dropped out of the
 * ones that stay — is in [lib/raw.ts](lib/raw.ts) and is applied at write time
 * too; this command is what brings a cache written before it into line and what
 * keeps it there afterwards.
 *
 *   pnpm cache:prune             # what would go, and what it would free
 *   pnpm cache:prune --apply     # empty the expired bodies. Frees pages, not disk
 *   pnpm cache:prune --compact   # ...and rebuild the file, so the disk gets it back
 *
 * A path may follow, as it may for `_merge.ts`, and then that file is the one
 * worked on instead of `data/cache.db` — which is how the rebuild is exercised
 * against something other than the 32 GB it was written for.
 *
 * **`--apply` is the routine one and does not shrink the file.** SQLite hands
 * emptied pages back to itself rather than to the filesystem, which is exactly
 * right for a daily step: the archive stops growing because tomorrow's crawl
 * writes into the space yesterday's gave up, and nothing has to be rewritten.
 * `--compact` is for the day the file is already too big — it writes a fresh
 * database beside the old one and swaps, so it needs room for the *result*,
 * not for a second copy of the original. A plain `VACUUM` needs the second copy
 * and was not an option on the disk that made this necessary.
 *
 * **Run it when nothing else is writing.** One writer on `cache.db` at a time;
 * a prune during a crawl is the second one.
 */

const APPLY = process.argv.includes('--apply') || process.argv.includes('--compact');
const COMPACT = process.argv.includes('--compact');
const FORCE = process.argv.includes('--force');

const KEPT = [...BODIES_KEPT_FOREVER];
/** `endpoint NOT IN (…)` for the endpoints whose bodies never expire. */
const EXPIRING = `endpoint NOT IN (${KEPT.map(() => '?').join(', ')})`;

/** The cache to work on. A bare argument wins over `data/cache.db`. */
const TARGET = process.argv.slice(2).find((argument) => !argument.startsWith('--')) ?? paths.cacheDb;
const COMPACT_FILE = `${TARGET}.compact`;

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
const gb = (bytes: number): string => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;

/**
 * Average body size per endpoint, from a sample rather than a sum.
 *
 * `sum(length(body))` over this table is eight minutes of reading every
 * overflow page on disk, which is not a price a dry run should charge for a
 * number that only has to be right to the nearest gigabyte.
 *
 * Newest first, because on a pruned archive the bodies are all at the end: the
 * same sample taken from the front reads the whole table to find two hundred
 * rows that still have one.
 */
function averageBody(db: Database.Database, endpoint: string): number {
  const row = db
    .prepare(
      `SELECT avg(length(body)) AS n FROM (
         SELECT body FROM raw_responses
         WHERE endpoint = ? AND body IS NOT NULL ORDER BY id DESC LIMIT 200)`
    )
    .get(endpoint) as { n: number | null };
  return row.n ?? 0;
}

function main(): void {
  if (!fs.existsSync(TARGET)) throw new Error(`no cache at ${TARGET}`);
  const db = new Database(TARGET);
  db.pragma('journal_mode = WAL');
  const cutoff = retentionCutoff(new Date());

  // Surveying and emptying each cost one pass over the table, and the table is
  // the reason this command exists. So the two are never both paid for: a dry
  // run reports and stops, `--apply` empties without first describing what it
  // is about to empty.
  if (!APPLY) {
    survey(db, cutoff);
    db.close();
    console.log('· dry run. `--apply` to empty them, `--compact` to give the disk them back');
    return;
  }

  /* ─────────────────────────────  The interlock  ────────────────────────── */

  // A body is allowed to expire because everything durable was already taken
  // out of it. `found_at` leaves at insert time and the ledger row it was read
  // from is never deleted, so the one extraction that can lag is the mining
  // seam — and the whole test is whether `data:mine` has read past the window,
  // because everything about to expire was fetched before it. No query: asking
  // the table which bodies are stale is the same eight-minute scan the emptying
  // is about to do anyway.
  const mined = getMeta(db, MINED_THROUGH);
  if ((!mined || mined < cutoff) && !FORCE) {
    db.close();
    console.error(
      `✗ cache:prune: the window opens at ${cutoff.slice(0, 16)} and data:mine` +
        `${mined ? ` last read to ${mined.slice(0, 16)}` : ' has never run on this cache'}.`
    );
    console.error(
      '  Bodies older than that are the only copy of the playlists their descriptions link to.\n' +
        '  Run `pnpm data:mine`, then this again. `--force` throws that seam away.'
    );
    process.exitCode = 1;
    return;
  }

  /* ────────────────────────────  Emptying, in place  ─────────────────────── */

  const emptied = emptyExpired(db, cutoff);
  console.log(`✓ cache:prune: ${emptied} bodies emptied, ledger untouched`);
  setMeta(db, 'pruned_at', new Date().toISOString());

  if (!COMPACT) {
    db.close();
    console.log(
      '· the file has not shrunk and does not need to: the freed pages are what' +
        ' tomorrow’s crawl writes into. `--compact` when the file itself is too big'
    );
    return;
  }

  db.close();
  compact();
}

/**
 * What the archive holds, in one pass.
 *
 * Every number here that needs the table is taken in the same scan, because on
 * the cache this was written for a scan is eight minutes of disk. The one
 * exception is the count of superseded copies, which `idx_raw_key` answers out
 * of the index in fifteen seconds without touching a body.
 */
function survey(db: Database.Database, cutoff: string): void {
  const rows = db
    .prepare(
      `SELECT endpoint,
              count(*) AS ledger,
              sum(CASE WHEN body IS NOT NULL THEN 1 ELSE 0 END) AS bodies,
              sum(CASE WHEN body IS NOT NULL AND fetched_at < ? THEN 1 ELSE 0 END) AS stale
       FROM raw_responses GROUP BY endpoint`
    )
    .all(cutoff) as Array<{ endpoint: string; ledger: number; bodies: number; stale: number }>;

  const duplicated = db
    .prepare(
      `SELECT endpoint, count(*) - count(DISTINCT request_key) AS n
       FROM raw_responses GROUP BY endpoint`
    )
    .all() as Array<{ endpoint: string; n: number }>;
  const dupes = new Map(duplicated.map((row) => [row.endpoint, row.n]));

  let freed = 0;
  let staying = 0;
  console.log(
    `· window ${BODY_RETENTION_DAYS} days, cutoff ${cutoff.slice(0, 10)}` +
      ` · ${rows.reduce((sum, row) => sum + row.ledger, 0)} rows in the ledger`
  );
  for (const row of [...rows].sort((a, b) => b.bodies - a.bodies)) {
    const forever = BODIES_KEPT_FOREVER.has(row.endpoint);
    const expiring = forever ? 0 : row.stale;
    const average = averageBody(db, row.endpoint);
    freed += expiring * average;
    staying += (row.bodies - expiring) * average;
    console.log(
      `  ${row.endpoint.padEnd(14)} ${String(row.bodies).padStart(7)} bodies` +
        ` · ${String(expiring).padStart(7)} expire ≈ ${mb(expiring * average).padStart(8)}` +
        ` · ${dupes.get(row.endpoint) ?? 0} asked more than once` +
        (forever ? '  (never expires)' : '')
    );
  }
  console.log(
    `· would free ≈ ${gb(freed)}, would keep ≈ ${gb(staying)} of bodies.` +
      ' The estimate counts what aged out; the superseded copies go with it'
  );
}

/**
 * Empties every body the policy no longer keeps, in id-order batches.
 *
 * Batched because the WAL holds every page a transaction touches, and one
 * statement over a 28 GB table is a WAL the size of the table — on the disk
 * that made this necessary, that is the failure it was supposed to prevent.
 */
function emptyExpired(db: Database.Database, cutoff: string): number {
  const BATCH = 20_000;
  const span = db.prepare(`SELECT min(id) AS lo, max(id) AS hi FROM raw_responses`).get() as {
    lo: number | null;
    hi: number | null;
  };
  if (span.lo === null || span.hi === null) return 0;

  const statement = db.prepare(
    `UPDATE raw_responses AS r SET body = NULL
     WHERE id BETWEEN ? AND ? AND body IS NOT NULL AND ${EXPIRING}
       AND (fetched_at < ?
            OR id < (SELECT max(id) FROM raw_responses AS newer
                     WHERE newer.endpoint = r.endpoint AND newer.request_key = r.request_key))`
  );

  let emptied = 0;
  for (let lo = span.lo; lo <= span.hi; lo += BATCH) {
    emptied += statement.run(lo, lo + BATCH - 1, ...KEPT, cutoff).changes;
    db.pragma('wal_checkpoint(TRUNCATE)');
  }
  return emptied;
}

/* ──────────────────────────────  The rebuild  ───────────────────────────── */

/**
 * Writes the cache out fresh and swaps it in, so the filesystem gets the space.
 *
 * Rowids are carried across explicitly. `_found.ts` binary-searches the archive
 * by rowid on the strength of "the table is only ever appended to", and a copy
 * that let SQLite hand out new ones would leave that search reading days off by
 * however many rows had been dropped.
 *
 * The original is replaced by a rename, and only after every table in the copy
 * has been counted against it — so a rebuild that dies halfway, or comes out
 * short, costs the scratch file and nothing else.
 */
function compact(): void {
  fs.rmSync(COMPACT_FILE, { force: true });
  const before = fs.statSync(TARGET).size;

  const out = new Database(COMPACT_FILE);
  out.pragma('journal_mode = OFF');
  out.pragma('synchronous = OFF');
  out.exec(`ATTACH DATABASE '${TARGET.replace(/'/g, "''")}' AS src`);

  const objects = out
    .prepare(
      `SELECT type, name, sql FROM src.sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC`
    )
    .all() as Array<{ type: string; name: string; sql: string }>;

  // Anything that is neither would be dropped in silence by the two loops below,
  // and a rebuild that quietly loses a view is worse than one that refuses.
  const unknown = objects.filter((object) => object.type !== 'table' && object.type !== 'index');
  if (unknown.length) {
    out.close();
    fs.rmSync(COMPACT_FILE, { force: true });
    throw new Error(
      `the schema has ${unknown.map((o) => `${o.type} ${o.name}`).join(', ')}, which this ` +
        'rebuild does not know how to carry. Teach it, or the original loses them'
    );
  }

  // Tables first, data next, indexes last: building an index once over a filled
  // table is a fraction of maintaining it across four million inserts.
  for (const object of objects) if (object.type === 'table') out.exec(object.sql);

  for (const object of objects) {
    if (object.type !== 'table' || object.name === 'raw_responses') continue;
    const moved = out.prepare(`INSERT INTO main."${object.name}" SELECT * FROM src."${object.name}"`).run();
    console.log(`  ${object.name.padEnd(16)} ${moved.changes} rows`);
  }

  copyArchive(out);

  for (const object of objects) if (object.type === 'index') out.exec(object.sql);

  /* ────────────────────────────────  Verify  ──────────────────────────────── */

  const mismatched: string[] = [];
  for (const object of objects) {
    if (object.type !== 'table') continue;
    const here = out.prepare(`SELECT count(*) AS n FROM main."${object.name}"`).get() as {
      n: number;
    };
    const there = out.prepare(`SELECT count(*) AS n FROM src."${object.name}"`).get() as { n: number };
    if (here.n !== there.n) mismatched.push(`${object.name}: ${here.n} vs ${there.n}`);
  }
  out.exec('DETACH DATABASE src');
  // Back into WAL before anyone else opens it. A fresh database is a rollback-
  // journal one, and setting the journal mode is itself a write — so a cache
  // left this way dies with "attempt to write a readonly database" the first
  // time a reader opens it, which is the incident `openDb` carries a comment
  // about. The pragma goes here rather than at the top because the bulk copy is
  // faster without a journal, and here there is nothing left to protect.
  out.pragma('journal_mode = WAL');
  out.close();

  if (mismatched.length) {
    console.error(`✗ cache:prune: the rebuild does not match the original — ${mismatched.join(', ')}`);
    console.error(`  the original is untouched; the attempt is at ${COMPACT_FILE}`);
    process.exitCode = 1;
    return;
  }

  const after = fs.statSync(COMPACT_FILE).size;
  fs.renameSync(COMPACT_FILE, TARGET);
  // The write-ahead log and shared-memory file belong to the file that has just
  // been replaced. Left behind, SQLite reads them as this one's and the cache
  // opens as a database whose pages moved under it.
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${TARGET}${suffix}`, { force: true });

  console.log(
    `✓ cache:prune --compact: ${gb(before)} → ${gb(after)}, ${gb(before - after)} back to the disk`
  );
}

/**
 * The archive, row by row: every ledger row, and a body only where it is kept.
 *
 * Two passes on purpose. The expired rows never mention `body`, so SQLite reads
 * their row header and leaves the overflow pages — the 24 GB — where they are;
 * only what survives is parsed, restripped and written. On the cache this was
 * written for that is 480 MB read out of 28 GB.
 */
function copyArchive(out: Database.Database): void {
  const cutoff = retentionCutoff(new Date());

  const ledger = out
    .prepare(
      `INSERT INTO main.raw_responses (id, endpoint, request_key, body, fetched_at)
       SELECT id, endpoint, request_key, NULL, fetched_at FROM src.raw_responses
       WHERE body IS NULL OR (${EXPIRING} AND fetched_at < ?)`
    )
    .run(...KEPT, cutoff);

  const insert = out.prepare(
    `INSERT INTO main.raw_responses (id, endpoint, request_key, body, fetched_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  // The surviving bodies are streamed off a second, read-only connection rather
  // than through the attached `src`. While an iterator of a better-sqlite3
  // connection is stepping, that connection is busy and refuses every other
  // statement — so reading and writing down one handle is not "slow", it throws
  // "this database connection is busy executing a query". Two handles is the
  // whole fix, and it keeps the walk streaming instead of materialising 3.5 GB
  // of bodies to get the cursor closed.
  const source = new Database(TARGET, { readonly: true });
  const select = source.prepare(
    `SELECT id, endpoint, request_key, body, fetched_at FROM raw_responses
     WHERE body IS NOT NULL AND NOT (${EXPIRING} AND fetched_at < ?)`
  );

  // One transaction around the whole walk. The journal is off on this file, so
  // holding it open costs nothing and saves a commit per row.
  let carried = 0;
  out.transaction(() => {
    for (const row of select.iterate(...KEPT, cutoff) as Iterable<{
      id: number;
      endpoint: string;
      request_key: string;
      body: string;
      fetched_at: string;
    }>) {
      insert.run(
        row.id,
        row.endpoint,
        row.request_key,
        restripStored(row.endpoint, row.body),
        row.fetched_at
      );
      carried += 1;
      if (carried % 2000 === 0)
        process.stdout.write(`\r  raw_responses    ${ledger.changes} ledger, ${carried} bodies`);
    }
  })();
  source.close();

  console.log(`\r  raw_responses    ${ledger.changes} ledger, ${carried} bodies carried`);
}

try {
  main();
} catch (error) {
  reportRunError(error);
}
