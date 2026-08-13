/**
 * Scratch: what `pnpm data:match --force` would do, before it is allowed to
 * write. Runs the rule pass as it stands now over every live titled playlist
 * and compares the verdict with the binding already stored, so the decision is
 * made against the catalogue rather than against a handful of titles that
 * happened to come to mind.
 *
 *   pnpm tsx scripts/_probe.ts            # counts, and which courses stop being empty
 *   pnpm tsx scripts/_probe.ts gained     # and every title in that column
 */
import { openDb, isBindingConfident, type PlaylistRow } from './lib/db.js';
import { loadSources } from './lib/sources.js';
import { buildKeywordIndex, matchByRules } from './lib/rules.js';

type StoredMatch = {
  playlist_id: string;
  course_id: string | null;
  confidence: number;
  reviewed: number;
};

const sources = loadSources();
const index = buildKeywordIndex(sources);
const db = openDb();

// Hand decisions outrank any pass, in both the file and the `reviewed` flag —
// `05-match.ts` never revisits them, so neither does this.
const overridden = new Set(Object.keys(sources.overrides.matches));
const stored = new Map<string, StoredMatch>();
for (const row of db.prepare(`SELECT * FROM matches`).all() as StoredMatch[]) {
  stored.set(row.playlist_id, row);
}

const rows = (
  db.prepare(`SELECT * FROM playlists WHERE alive = 1 AND title IS NOT NULL`).all() as PlaylistRow[]
).filter((row) => !overridden.has(row.id) && stored.get(row.id)?.reviewed !== 1);

const moved: Array<{ row: PlaylistRow; from: string | null; to: string | null }> = [];
for (const row of rows) {
  const before = stored.get(row.id);
  const from = before?.course_id && isBindingConfident(before) ? before.course_id : null;
  const verdict = matchByRules(row, index);
  const to = verdict && verdict.confidence >= 0.75 ? verdict.courseId : null;
  if (from !== to) moved.push({ row, from, to });
}

const gained = moved.filter((m) => !m.from && m.to);
const lost = moved.filter((m) => m.from && !m.to);
const changed = moved.filter((m) => m.from && m.to);

console.log(`живых плейлистов с названием: ${rows.length}`);
console.log(`+ привяжется впервые: ${gained.length}`);
console.log(`- потеряет привязку:  ${lost.length}`);
console.log(`~ сменит курс:        ${changed.length}`);

/*
 * Which courses stop being empty — the only number this whole change is for.
 * Counted as whole states rather than as a delta: a course losing one of its
 * thirty playlists has not been emptied, and the delta cannot tell the
 * difference.
 */
const hand = new Set(Object.values(sources.overrides.matches).filter(Boolean) as string[]);
const boundBefore = new Set(hand);
const boundAfter = new Set(hand);
const after = new Map(moved.map((m) => [m.row.id, m.to]));
for (const row of rows) {
  const before = stored.get(row.id);
  if (before?.course_id && isBindingConfident(before)) boundBefore.add(before.course_id);
  const now = after.has(row.id)
    ? after.get(row.id)
    : before?.course_id && isBindingConfident(before)
      ? before.course_id
      : null;
  if (now) boundAfter.add(now);
}
// Reviewed rows and overridden playlists were filtered out of `rows` above, and
// they keep whatever they were bound to either way.
for (const match of stored.values()) {
  if (match.reviewed === 1 && match.course_id) {
    boundBefore.add(match.course_id);
    boundAfter.add(match.course_id);
  }
}
const filled = [...boundAfter].filter((course) => !boundBefore.has(course));
const emptied = [...boundBefore].filter((course) => !boundAfter.has(course));
console.log(`\nкурсов с материалом: ${boundBefore.size} → ${boundAfter.size}`);
console.log(`перестанут быть пустыми (${filled.length}): ${filled.join(', ') || '—'}`);
console.log(`опустеют (${emptied.length}): ${emptied.join(', ') || '—'}`);

const which = process.argv[2];
const column = which === 'gained' ? gained : which === 'lost' ? lost : which === 'changed' ? changed : [];
for (const { row, from, to } of column) {
  console.log(`  ${(from ? `${from} → ` : '') + (to ?? '—')}`.padEnd(42) + ` ${row.title}`);
}

db.close();
