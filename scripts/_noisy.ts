/**
 * Scratch: which keywords are pulling their weight, and which are just noise?
 *
 * `data/keywords/*.json` warns that a loose synonym is load-bearing — «survey»
 * sat under `field-archaeology` and claimed land surveying, geological surveys,
 * survey data and four surveys *of English literature*, none of them
 * archaeology and none of them confident enough to publish. The damage from a
 * keyword like that is invisible in the catalogue and real everywhere else: it
 * fills the review queue and it moves playlists up the video queue's tiers,
 * which is quota.
 *
 * So this asks of every phrase in the index: how often is it the winning
 * phrase, and how often does that win clear the bar? A phrase with many claims
 * and no confident ones is a phrase that means something else in five fields.
 *
 *   pnpm tsx scripts/_noisy.ts [minimum claims]
 *
 * Costs nothing — a query over cache.db and the rule pass in memory. Judgement
 * still required: a rare word with one weak claim is not evidence of anything,
 * and a keyword that is genuinely a course's whole name will look "noisy" here
 * if the course simply has no material yet.
 *
 * `overrides.yaml` has to be read, not just the `matches` table, and the first
 * version of this was wrong for want of it. A playlist bound by hand keeps
 * whatever stale guess a pass last wrote — the hand decision outranks it and
 * nothing ever revisits the row — so «теоретическая механика» looked like a
 * keyword that never once convinced anybody, when in fact every playlist it
 * names was bound to exactly the course it claims, in the file that wins.
 */
import { MATCH_THRESHOLD, openDb } from './lib/db.js';
import { buildKeywordIndex, cleanSegments, findPhrase } from './lib/rules.js';
import { loadSources } from './lib/sources.js';

const minimum = Number(process.argv[2] ?? 3);

const sources = loadSources();
const index = buildKeywordIndex(sources);
const db = openDb({ readonly: true });

type Stat = { courseId: string; claims: number; confident: number; examples: string[] };
const stats = new Map<string, Stat>();

const rows = db
  .prepare(
    `SELECT p.id, p.title, m.course_id, m.confidence
     FROM playlists p LEFT JOIN matches m ON m.playlist_id = p.id
     WHERE p.alive = 1 AND p.title IS NOT NULL AND p.title <> ''`
  )
  .all() as Array<{
  id: string;
  title: string;
  course_id: string | null;
  confidence: number | null;
}>;

for (const row of rows) {
  // A hand decision is the strongest confirmation a keyword can have, and it
  // is the one the `matches` table does not carry.
  const decided = sources.overrides.matches[row.id];
  const boundTo = decided === undefined ? row.course_id : decided;
  const settled =
    decided !== undefined ? decided !== null : (row.confidence ?? 0) >= MATCH_THRESHOLD;

  for (const segment of cleanSegments(row.title)) {
    // The index is longest-first, so the first phrase found in a clause is the
    // one that would win it — the same choice `matchSegment` makes.
    const winner = index.find((entry) => findPhrase(segment, entry.phrase) !== -1);
    if (!winner) continue;
    const key = `${winner.courseId} ${winner.phrase}`;
    const stat = stats.get(key) ?? {
      courseId: winner.courseId,
      claims: 0,
      confident: 0,
      examples: [],
    };
    stat.claims += 1;
    if (settled && boundTo === winner.courseId) stat.confident += 1;
    else if (stat.examples.length < 4) stat.examples.push(row.title.slice(0, 62));
    stats.set(key, stat);
    break;
  }
}

const noisy = [...stats]
  .map(([key, stat]) => ({ phrase: key.slice(stat.courseId.length + 1), ...stat }))
  .filter((stat) => stat.claims >= minimum && stat.confident === 0)
  .sort((a, b) => b.claims - a.claims);

console.log(
  `${noisy.length} keywords claim ${minimum}+ clauses and never once confidently ` +
    `(of ${stats.size} that claim anything)\n`
);
for (const stat of noisy.slice(0, 30)) {
  console.log(`${String(stat.claims).padStart(4)} claims · ${stat.courseId} ← «${stat.phrase}»`);
  for (const example of stat.examples) console.log(`        ${example}`);
}
db.close();
