/**
 * Scratch: which channels does the catalogue keep choosing but never crawl?
 *
 * Every playlist bound to a course names a channel. A channel that keeps
 * turning up in those decisions and is missing from `data/channels.yaml` is a
 * hole in that file — it reached the catalogue sideways, through an
 * awesome-list or a mined description, and its other courses were never looked
 * at. That is a far better signal than any «best channels» listicle: it is the
 * catalogue's own revealed preference.
 *
 * Costs nothing — a query over cache.db and the two YAML files.
 *
 *   pnpm tsx scripts/_holes.ts [minimum]
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { paths } from './lib/config.js';
import { MATCH_THRESHOLD, openDb } from './lib/db.js';

const minimum = Number(process.argv[2] ?? 2);
const db = openDb({ readonly: true });

const listed = new Set<string>();
for (const entry of (parse(fs.readFileSync(path.join(paths.data, 'channels.yaml'), 'utf8')) ??
  []) as Array<{ id: string }>)
  listed.add(entry.id.toLowerCase());

const overrides = parse(fs.readFileSync(path.join(paths.data, 'overrides.yaml'), 'utf8')) as {
  matches?: Record<string, string | null>;
} | null;
const decided = Object.entries(overrides?.matches ?? {})
  .filter(([, course]) => course)
  .map(([playlist]) => playlist);

/**
 * Bound means bound by a person or confidently by a pass — a weak guess is not
 * a preference, it is a coin toss, and counting it would rank the channels the
 * rules are worst at rather than the ones the catalogue wants.
 */
const rows = db
  .prepare(
    `SELECT c.id, c.title, c.handle, count(*) AS bound
     FROM matches m
     JOIN playlists p ON p.id = m.playlist_id
     JOIN channels c ON c.id = p.channel_id
     WHERE p.alive = 1 AND m.course_id IS NOT NULL
       AND (m.reviewed = 1 OR m.confidence >= ? OR m.playlist_id IN (${decided
         .map(() => '?')
         .join(',') || "''"}))
     GROUP BY c.id
     ORDER BY bound DESC`
  )
  .all(MATCH_THRESHOLD, ...decided) as Array<{
  id: string;
  title: string | null;
  handle: string | null;
  bound: number;
}>;

const holes = rows.filter(
  (row) =>
    row.bound >= minimum &&
    !listed.has(row.id.toLowerCase()) &&
    !(row.handle && listed.has(row.handle.toLowerCase()))
);

console.log(
  `${holes.length} channels own ${minimum}+ bound playlists and are not in channels.yaml` +
    ` (of ${rows.length} channels with any)`
);
for (const row of holes) {
  const total = db
    .prepare(`SELECT count(*) AS n FROM playlists WHERE channel_id = ? AND alive = 1`)
    .get(row.id) as { n: number };
  console.log(
    `${String(row.bound).padStart(4)} bound · ${String(total.n).padStart(4)} known · ` +
      `${row.handle ?? row.id}  ${row.title ?? ''}`
  );
}
console.log('\n· check a candidate with `pnpm tsx scripts/_vet.ts`, the bar is docs/harvest.md');
db.close();
