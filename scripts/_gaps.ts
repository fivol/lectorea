/**
 * Scratch: is a course worth adding?
 *
 * The reading pass on 2026-08-16 kept answering `ok` with a shrug — «Fluid
 * Mechanics» filed under transport phenomena, «Analytic Geometry» under linear
 * algebra, «Архитектура компьютера и ОС» under operating systems. Those are not
 * matching mistakes. They are the catalogue being asked for a course it does
 * not have, and answering with the nearest one it does.
 *
 * A hole is easy to feel and easy to imagine, so this counts it instead. Each
 * candidate is measured the way `_markers.ts` measures a refusal word — twice,
 * and the second number is the one that decides:
 *
 *   waiting   alive playlists of 8+ videos naming it that no course holds **and
 *             that no reader has refused**, which is what a new course would
 *             gain;
 *   taken     playlists naming it that are already published under some other
 *             course, listed by which — the ones a new course would move;
 *   refused   playlists naming it that a reader has already answered
 *             `not-a-course`. Counted apart and never added in, because a
 *             course cannot rescue a vendor dump: on the phrases where this
 *             matters — «data science», «web development», «cloud computing» —
 *             it is most of the hits, and folding it into `waiting` is how a
 *             gap report talks somebody into a course with nothing behind it.
 *
 * A candidate with nothing waiting is a course nobody has filmed. A candidate
 * whose `taken` is spread over five unrelated courses is usually a homonym
 * rather than a subject ([data-traps.md](../docs/agents/data-traps.md)), and a
 * candidate whose `taken` is concentrated in one course is exactly the case
 * this file was written for: the nearest-fit answer, at scale.
 *
 *   pnpm tsx scripts/_gaps.ts                     # the table
 *   pnpm tsx scripts/_gaps.ts fluid-mechanics     # and the titles behind one row
 *
 * Costs nothing. Nothing is written — `pnpm course:new` is what writes.
 */
import { openDb } from './lib/db.js';
import { loadSources } from './lib/sources.js';

const wanted = process.argv[2];

/** Word-boundary, case-insensitive, both alphabets — `_markers.ts`'s test. */
const at = (title: string, phrase: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${phrase}(?![\\p{L}\\p{N}])`, 'iu').test(title);

/**
 * The candidates the 2026-08-16 reading produced, as `id` and the phrases that
 * name it in a title. Russian included wherever the seams actually publish it:
 * a third of this catalogue is Russian and an English-only probe would report
 * half of every hole.
 */
const CANDIDATES: Array<[id: string, phrases: string]> = [
  // Engineering — the domain the reading complained about most.
  ['fluid-mechanics', 'fluid mechanics|fluid dynamics|hydraulics|механика жидкости|гидравлика|гидродинамика'],
  ['materials-science', 'materials science|material science|материаловедение'],
  ['heat-transfer', 'heat transfer|heat and mass transfer|теплопередача|тепломассообмен'],
  ['electrical-machines', 'electrical machines?|electric machines?|energy conversion|электрические машины|электропривод'],
  ['power-systems', 'power systems?|power plant engineering|электроэнергетик\\p{L}*|электрические сети'],
  ['microprocessors', 'microprocessors?|microcontrollers?|embedded systems?|микропроцессор\\p{L}*|микроконтроллер\\p{L}*'],
  ['communication-systems', 'communication systems?|digital communications?|communication engineering|теория связи'],
  ['engineering-drawing', 'engineering drawing|engineering graphics|technical drawing|начертательная геометрия|инженерная графика'],
  ['thermal-engineering', 'thermal engineering|internal combustion|теплотехника'],
  // Named by a reader on 2026-08-17, filing «Power Electronics» under
  // `power-systems` for want of anywhere better. Unmeasured so far.
  ['power-electronics', 'power electronics|converters?|силовая электроника|преобразовательная техника'],

  // Computer science.
  ['high-performance-computing', 'high performance computing|parallel computing|parallel programming|параллельное программирование|суперкомпьютер\\p{L}*'],
  ['data-science', 'data science|наука о данных|анализ данных'],
  ['cloud-computing', 'cloud computing|облачные вычислени\\p{L}*|kubernetes'],
  ['web-development', 'web development|web programming|веб-программирование|веб-разработка'],
  ['mobile-development', 'mobile application development|android development|ios development|мобильн\\p{L}* разработка'],
  ['human-computer-interaction', 'human computer interaction|human-computer interaction|user interface design|взаимодействие человека и компьютера'],

  // Mathematics.
  ['analytic-geometry', 'analytic geometry|analytical geometry|аналитическая геометрия'],
  ['homological-algebra', 'homological algebra|homology|гомологическая алгебра|гомологии'],
  ['algebraic-geometry', 'algebraic geometry|алгебраическая геометрия'],
  ['lie-theory', 'lie groups?|lie algebras?|группы ли|алгебры ли'],
  ['mathematical-physics', 'mathematical physics|математическая физика|методы математической физики'],

  // Physics — the «Physics II» case two readers hit independently.
  ['general-physics-2', 'physics (ii|2)|общая физика(?:\\s*[-–—]?\\s*)?(ii|2)'],

  // Business and management, where the catalogue stops at seven courses.
  ['accounting', 'accounting|financial accounting|бухгалтерский учет|бухгалтерский учёт'],
  ['business-communication', 'business communication|деловая коммуникация|деловое общение'],
  ['international-business', 'international business|международный бизнес'],
  ['entrepreneurship', 'entrepreneurship|startups?|предпринимательство|стартап\\p{L}*'],
  ['supply-chain-management', 'supply chain|логистика'],

  // Elsewhere.
  ['public-health', 'public health|общественное здоровье|здравоохранение'],
  ['biophysics', 'biophysics|биофизика'],
  ['geography-physical', 'physical geography|физическая география'],
  ['art-theory', 'art theory|aesthetics|эстетика'],
];

type Row = {
  id: string;
  title: string;
  videos: number;
  course: string | null;
  published: number;
  verdict: string | null;
};

const sources = loadSources();
const known = new Set(sources.courses.map((course) => course.id));
const db = openDb({ readonly: true });

/*
 * `published` is the gate the catalogue actually applies, not the matcher's
 * own: a binding the reader refused is not "taken" by the course it names, it
 * is waiting like everything else. Reading it any other way would have counted
 * 1204 refused rows on 2026-08-16 as courses already served.
 */
const rows = db
  .prepare(
    `SELECT p.id, p.title, p.video_count AS videos, m.course_id AS course, v.verdict,
            CASE WHEN m.course_id IS NOT NULL AND m.confidence >= 0.75
                  AND (m.reviewed = 1 OR v.verdict = 'ok' OR v.verdict = 'wrong-course')
                 THEN 1 ELSE 0 END AS published
       FROM playlists p
       LEFT JOIN matches m ON m.playlist_id = p.id
       LEFT JOIN verdicts v ON v.playlist_id = p.id
      WHERE p.alive = 1 AND p.video_count >= 8 AND p.title IS NOT NULL AND p.title <> ''`
  )
  .all() as Row[];

console.log(`· ${rows.length} alive playlists of 8+ videos · ${known.size} courses\n`);

const table: Array<{ id: string; waiting: number; taken: number; refused: number; top: string }> =
  [];

for (const [id, phrases] of CANDIDATES) {
  const hits = rows.filter((row) => at(row.title, phrases));
  const refused = hits.filter((row) => row.verdict === 'not-a-course');
  const waiting = hits.filter((row) => !row.published && row.verdict !== 'not-a-course');
  const taken = hits.filter((row) => row.published);

  const byCourse = new Map<string, number>();
  for (const row of taken) {
    const course = row.course ?? '?';
    byCourse.set(course, (byCourse.get(course) ?? 0) + 1);
  }
  const top = [...byCourse]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([course, n]) => `${course}×${n}`)
    .join(' ');

  if (wanted && wanted !== id) continue;
  table.push({
    id,
    waiting: waiting.length,
    taken: taken.length,
    refused: refused.length,
    top,
  });

  if (!wanted) continue;
  console.log(`— waiting (${waiting.length}), what a new course would gain:`);
  for (const row of waiting.sort((a, b) => b.videos - a.videos).slice(0, 40)) {
    console.log(`  ${String(row.videos).padStart(4)}×  ${row.title.slice(0, 78)}`);
  }
  console.log(`\n— taken (${taken.length}), what it would move:`);
  for (const row of taken.sort((a, b) => b.videos - a.videos).slice(0, 40)) {
    console.log(
      `  ${String(row.videos).padStart(4)}×  ${(row.course ?? '?').padEnd(24)} ${row.title.slice(0, 52)}`
    );
  }
}

if (!wanted) {
  console.log('  waiting  taken  refused  course                        already filed under');
  for (const row of table.sort((a, b) => b.waiting + b.taken - (a.waiting + a.taken))) {
    const exists = known.has(row.id) ? ' (exists)' : '';
    console.log(
      `  ${String(row.waiting).padStart(7)}  ${String(row.taken).padStart(5)}  ` +
        `${String(row.refused).padStart(7)}  ${(row.id + exists).padEnd(28)}  ${row.top}`
    );
  }
  console.log('\n· name a row to see its titles: pnpm tsx scripts/_gaps.ts fluid-mechanics');
}

db.close();
