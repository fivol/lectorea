/**
 * Scratch: *why* did the rule pass refuse these playlists?
 *
 * `matches` records the verdict and never the reason, so nine thousand
 * refusals read as one problem when they are really five. A hand review that
 * starts from that list reads titles one at a time and fixes them one at a
 * time; a hand review that starts from the reason goes after the cluster a
 * single keyword unlocks. This replays the pass over every refused title and
 * sorts them by the step that stopped them.
 *
 * The companion of `_probe.ts`: this one says what to change, that one says
 * what changing it would do to the catalogue as a whole. Neither writes.
 *
 *   pnpm tsx scripts/_refusals.ts                  # the counts
 *   pnpm tsx scripts/_refusals.ts weak-coverage    # and the titles in one bucket
 *   pnpm tsx scripts/_refusals.ts no-phrase out.json
 *
 * Costs nothing — a query over cache.db and the rule pass in memory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { paths } from './lib/config.js';
import { MATCH_THRESHOLD, openDb, type PlaylistRow } from './lib/db.js';
import { buildKeywordIndex, cleanSegments, matchByRules } from './lib/rules.js';
import { loadSources } from './lib/sources.js';

/** Below this a playlist is a fragment or a trailer, not a course to review. */
const MIN_VIDEOS = 8;

const [wanted, outFile] = process.argv.slice(2);

const sources = loadSources();
const index = buildKeywordIndex(sources);
const db = openDb({ readonly: true });

type Row = {
  id: string;
  title: string;
  video_count: number;
  handle: string | null;
  ctitle: string | null;
  cid: string;
  course_id: string | null;
  confidence: number | null;
};

const rows = db
  .prepare(
    `SELECT p.id, p.title, p.video_count, c.handle, c.title ctitle, c.id cid,
            m.course_id, m.confidence
     FROM playlists p JOIN channels c ON c.id = p.channel_id
     LEFT JOIN matches m ON m.playlist_id = p.id
     WHERE p.alive = 1 AND p.video_count >= ? AND p.title IS NOT NULL AND p.title <> ''
       AND (m.course_id IS NULL OR (m.reviewed = 0 AND m.confidence < ?))`
  )
  .all(MIN_VIDEOS, MATCH_THRESHOLD) as Row[];

/**
 * A channel already in `channels.yaml` was judged to teach courses, so its
 * refusals are the ones worth a person's time — a refusal on a channel nobody
 * vetted is usually the rules working.
 */
const listed = new Set<string>();
for (const entry of (parse(fs.readFileSync(path.join(paths.data, 'channels.yaml'), 'utf8')) ??
  []) as Array<{ id: string }>)
  listed.add(entry.id.toLowerCase());
const trusted = (row: Row) =>
  listed.has((row.handle ?? '').toLowerCase()) || listed.has(row.cid.toLowerCase());

/**
 * The step that said no. Each one wants a different fix, which is the whole
 * point of separating them:
 *
 *   not-a-course     the `NOT_A_COURSE` list caught a clause. Usually right.
 *   no-phrase        no course keyword occurs at all — either the catalogue
 *                    has no such course, or the name it is known by is missing
 *                    from data/keywords and data/aliases. This is the bucket
 *                    that grows the catalogue.
 *   weak-coverage    the subject is in the title but is a minority of its
 *                    clause. Either a genuine passing mention, or a clause the
 *                    segmenter should have split further.
 *   ambiguous        two courses claim the title equally, or two clauses each
 *                    name one convincingly. Precisely what a human is for.
 *   below-threshold  matched, but under 0.75 — the review queue proper.
 */
type Reason = 'not-a-course' | 'no-phrase' | 'weak-coverage' | 'ambiguous' | 'below-threshold';

const buckets = new Map<Reason, Row[]>();
const push = (reason: Reason, row: Row) =>
  buckets.set(reason, [...(buckets.get(reason) ?? []), row]);

for (const row of rows) {
  const playlist = { title: row.title } as PlaylistRow;
  if (matchByRules(playlist, index)) {
    push('below-threshold', row);
    continue;
  }
  const segments = cleanSegments(row.title);
  if (!segments.length) {
    push('no-phrase', row);
    continue;
  }
  // `matchByRules` refuses support material before it looks at anything else,
  // so a title with no phrase in it at all and a title full of them are
  // indistinguishable from the outside. Asked segment by segment they separate.
  const hits = segments.flatMap((segment) =>
    index.filter((entry) => segment.includes(entry.phrase)).map((entry) => ({ segment, entry }))
  );
  if (!hits.length) {
    push('no-phrase', row);
    continue;
  }
  const courses = new Set(hits.map((hit) => hit.entry.courseId));
  const covers = hits.some((hit) => hit.entry.phrase.length / hit.segment.length >= 0.45);
  push(covers && courses.size > 1 ? 'ambiguous' : covers ? 'not-a-course' : 'weak-coverage', row);
}

console.log(`${rows.length} refused playlists with ${MIN_VIDEOS}+ videos\n`);
for (const [reason, list] of [...buckets].sort((a, b) => b[1].length - a[1].length))
  console.log(
    `${String(list.length).padStart(6)}  ${reason.padEnd(16)} ` +
      `${String(list.filter(trusted).length).padStart(5)} on a vetted channel`
  );

if (!wanted) {
  console.log('\n· name a bucket to list it: pnpm tsx scripts/_refusals.ts no-phrase [out.json]');
  db.close();
  process.exit(0);
}

const chosen = (buckets.get(wanted as Reason) ?? [])
  .filter(trusted)
  .sort((a, b) => b.video_count - a.video_count);

console.log(`\n── ${wanted}: ${chosen.length} on vetted channels ──`);
for (const row of chosen.slice(0, 80))
  console.log(
    `${String(row.video_count).padStart(4)}  ${(row.handle ?? row.ctitle ?? '').padEnd(24)}` +
      `  ${row.title.slice(0, 88)}`
  );

if (outFile) {
  fs.writeFileSync(
    outFile,
    JSON.stringify(
      chosen.map((row) => ({
        id: row.id,
        title: row.title,
        videos: row.video_count,
        channel: row.handle ?? row.ctitle,
        guessed: row.course_id,
        confidence: row.confidence,
        segments: cleanSegments(row.title),
      })),
      null,
      1
    )
  );
  console.log(`\n→ ${outFile}`);
}
db.close();
