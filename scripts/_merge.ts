/**
 * Scratch: a snapshot **merged** into this cache, instead of swapped over it.
 *
 *   gh release download data-cache --pattern cache.db.gz -D /tmp && gunzip /tmp/cache.db.gz
 *   pnpm tsx scripts/_merge.ts /tmp/cache.db            # counts, writes nothing
 *   pnpm tsx scripts/_merge.ts /tmp/cache.db --apply
 *
 * `cache:restore` replaces every table in the snapshot — `DELETE FROM`, then
 * insert — and for a *stale* copy that is exactly right: a playlist's video
 * count is a fact about YouTube and the newest copy of it wins. The hole is the
 * other half of a row's meaning: **a crawl row is also a discovery, and a
 * discovery accumulates wherever the asking happened.** A playlist this machine
 * bought with a 100-unit search and the release has never seen is not a stale
 * copy of anything — it is the only copy, and the replace deletes it.
 *
 * That is the state this was written for (2026-08-24): the release held 93 134
 * videos, 370 channels and 3151 matches from three nights of the runner, this
 * cache held 265 playlists and their jobs from three days of hunting, and
 * either direction of the existing pair — pull, or publish — threw one of the
 * two away.
 *
 * So: **nothing is ever deleted, and on a collision the snapshot wins.** The
 * second half is what makes it a restore rather than a guess — the only time
 * anything restores at all is when the release is the newer generation, so its
 * copy of a shared row is the fresher one by construction. Where a table
 * carries a timestamp the win is conditional on it, which costs nothing and
 * covers the case where this machine refreshed a row after the snapshot was
 * cut.
 *
 * `found_at` is coalesced rather than overwritten in both directions: it is
 * reconstructed per machine by `_found.ts` from raw bodies the snapshot does not
 * carry, so a null in the incoming row means "not computed there", never "not
 * found".
 */
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { paths } from './lib/config.js';

/** Never in a snapshot, and 3.5 GB of this machine's own API bodies. */
const HEAVY = 'raw_responses';

/**
 * How each table decides a collision, and what a row is keyed by.
 *
 * `key` is the natural key rather than the declared one where they differ:
 * `jobs.id` is a surrogate that counts up independently on two machines, so
 * merging on it would file one machine's job under another's number. The unique
 * index on (type, target) is what a job actually is.
 *
 * `fresh` is the column that says which copy is newer. Null means the table has
 * no such column and the snapshot simply wins.
 */
const TABLES: Record<string, { key: string[]; fresh: string | null; surrogate?: string }> = {
  playlists: { key: ['id'], fresh: 'checked_at' },
  videos: { key: ['id'], fresh: null },
  channels: { key: ['id'], fresh: 'last_discovered_at' },
  matches: { key: ['playlist_id'], fresh: 'updated_at' },
  // `surrogate` is carried over rather than copied: two machines count their
  // own job ids up independently, so the incoming 95 200 is a different job
  // from the local one, and inserting it would fail on the primary key instead
  // of resolving through the (type, target) index this actually merges on.
  jobs: { key: ['type', 'target'], fresh: 'updated_at', surrogate: 'id' },
  verdicts: { key: ['playlist_id'], fresh: 'checked_at' },
  ownership: { key: ['playlist_id'], fresh: 'checked_at' },
  searches: { key: ['id'], fresh: 'checked_at' },
  // Two machines spending the same key on the same day are two halves of one
  // number, and nothing here can tell that from two copies of one half. The
  // larger is the safer read: an over-count costs an unspent thousand units, an
  // under-count costs a run that walks into 403s believing it has room.
  quota: { key: ['date', 'key'], fresh: null },
};

/** Written by hand at the end — it is a claim about lineage, not a row. */
const SKIP = new Set([HEAVY, 'meta']);

function main(): void {
  const incoming = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!incoming || !fs.existsSync(incoming)) {
    console.error('Usage: pnpm tsx scripts/_merge.ts <snapshot.db> [--apply]');
    process.exit(1);
  }

  // Read-only without `--apply`, and not as a nicety: a second *writing*
  // connection is what kills a running crawl with SQLITE_BUSY_SNAPSHOT, and a
  // command whose whole purpose is to look before deciding must be safe to run
  // while the day's crawl is going.
  const db = new Database(paths.cacheDb, { readonly: !apply });
  if (apply) db.pragma('journal_mode = WAL');
  db.prepare(`ATTACH DATABASE ? AS snap`).run(incoming);

  const columns = (schema: string, table: string): string[] =>
    (db.prepare(`PRAGMA ${schema}.table_info("${table}")`).all() as Array<{ name: string }>).map(
      (column) => column.name
    );
  const count = (schema: string, table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS rows FROM ${schema}."${table}"`).get() as { rows: number }).rows;

  const tables = (
    db
      .prepare(
        `SELECT name FROM snap.sqlite_master
         WHERE type = 'table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`
      )
      .all() as Array<{ name: string }>
  )
    .map((row) => row.name)
    .filter((name) => !SKIP.has(name));

  const unknown = tables.filter((name) => !TABLES[name]);
  if (unknown.length) {
    // A table added since this was written is a table nobody has decided the
    // collision rule for, and guessing one is how the 682 probes went.
    throw new Error(`no merge rule for ${unknown.join(', ')} — add one to TABLES`);
  }

  const report: Array<Record<string, unknown>> = [];

  const run = db.transaction(() => {
    for (const table of tables) {
      const { key, fresh, surrogate } = TABLES[table];
      const theirs = columns('snap', table);
      const mine = columns('main', table);
      const shared = theirs
        .filter((column) => mine.includes(column))
        .filter((column) => column !== surrogate);
      const list = shared.map((column) => `"${column}"`).join(', ');
      const on = key.map((column) => `"${column}"`).join(', ');

      const before = count('main', table);
      const incomingRows = count('snap', table);
      const missing = (
        db
          .prepare(
            `SELECT COUNT(*) AS rows FROM snap."${table}" s
             WHERE NOT EXISTS (SELECT 1 FROM main."${table}" m
                               WHERE ${key.map((c) => `m."${c}" IS s."${c}"`).join(' AND ')})`
          )
          .get() as { rows: number }
      ).rows;

      if (apply) {
        const set = shared
          .filter((column) => !key.includes(column))
          .map((column) =>
            column === 'found_at'
              ? `"found_at" = COALESCE(old."found_at", excluded."found_at")`
              : `"${column}" = excluded."${column}"`
          )
          .join(', ');
        const guard =
          fresh && shared.includes(fresh)
            ? ` WHERE excluded."${fresh}" > old."${fresh}" OR old."${fresh}" IS NULL`
            : '';
        // `WHERE true` before ON CONFLICT: without it SQLite reads the clause as
        // part of the SELECT and refuses the statement.
        db.exec(
          `INSERT INTO main."${table}" AS old (${list})
           SELECT ${list} FROM snap."${table}" WHERE true
           ON CONFLICT(${on}) DO UPDATE SET ${set}${guard}`
        );
      }

      report.push({
        table,
        here: before,
        release: incomingRows,
        'release only': missing,
        'here only': before - (incomingRows - missing),
        after: apply ? count('main', table) : before + missing,
      });
    }
  });

  run();
  console.table(report);

  if (!apply) {
    console.log('· nothing written — pass --apply');
  } else {
    // The lineage this cache now descends from. It holds everything the
    // snapshot did, so claiming an older generation would send the next pull
    // down the same path again.
    const stamp = (
      db.prepare(`SELECT value FROM snap.meta WHERE key = 'snapshot_published_at'`).get() as
        | { value: string }
        | undefined
    )?.value;
    if (stamp) {
      db.prepare(
        `INSERT INTO main.meta (key, value) VALUES ('snapshot_published_at', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(stamp);
      console.log(`✓ merged, and this cache now descends from ${stamp}`);
      console.log('  It holds rows the release does not — pnpm cache:publish sends them up.');
    }
  }

  db.exec(`DETACH DATABASE snap`);
  db.close();
}

main();
