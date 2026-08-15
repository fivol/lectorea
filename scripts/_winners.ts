/**
 * Scratch: which keyword won each confident binding, and what it dragged in.
 *
 * `_noisy.ts` asks the opposite question — which keywords claim clauses and
 * never win one. A keyword that wins on the *wrong* titles is invisible to
 * that, and is the expensive kind: it does not cost a review queue, it puts a
 * music playlist in the catalogue and nobody looks again.
 *
 * Read it as a list and the bad ones announce themselves, because the sample
 * titles under a good keyword all name the same subject and the sample titles
 * under a bad one have nothing to do with each other. Five came out of one
 * reading on 2026-08-15: `genre`, `classical music`, `motivation`, `stars`,
 * `crime` — plus `micro`, which owned seven micro:bit playlists.
 *
 *   pnpm tsx scripts/_winners.ts
 *
 * Costs nothing. Marking a word `?word` in data/keywords keeps it for search
 * and takes it out of the rules; see docs/scripts/matching.md.
 */
import { openDb } from './lib/db.js';
import { buildKeywordIndex, cleanSegments, findPhrase } from './lib/rules.js';
import { loadSources } from './lib/sources.js';

const sources = loadSources();
const index = buildKeywordIndex(sources);
const db = openDb({ readonly: true });

const rows = db
  .prepare(
    `SELECT p.title, p.video_count, m.course_id FROM matches m
     JOIN playlists p ON p.id = m.playlist_id
     WHERE p.alive = 1 AND m.confidence >= 0.75 AND m.reviewed = 0 AND m.method = 'rule'`
  )
  .all() as Array<{ title: string; video_count: number; course_id: string }>;

const byPhrase = new Map<string, { course: string; titles: string[] }>();
for (const row of rows) {
  if (!row.title) continue;
  const segments = cleanSegments(row.title);
  let winner: { phrase: string; courseId: string } | null = null;
  for (const segment of segments) {
    for (const entry of index) {
      if (entry.courseId !== row.course_id) continue;
      if (findPhrase(segment, entry.phrase) !== -1) {
        if (!winner || entry.phrase.length > winner.phrase.length) winner = entry;
        break;
      }
    }
  }
  if (!winner) continue;
  const key = `${winner.courseId} ← ${winner.phrase}`;
  const bucket = byPhrase.get(key) ?? { course: winner.courseId, titles: [] };
  bucket.titles.push(`${row.video_count}× ${row.title.slice(0, 70)}`);
  byPhrase.set(key, bucket);
}

const sorted = [...byPhrase].sort((a, b) => b[1].titles.length - a[1].titles.length);
for (const [key, bucket] of sorted) {
  console.log(`\n${key}  (${bucket.titles.length})`);
  for (const title of bucket.titles.slice(0, 4)) console.log('   ', title);
}
db.close();
