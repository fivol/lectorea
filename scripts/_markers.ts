/**
 * Scratch: is a word safe to refuse on?
 *
 * A refusal rule is a guess about thirty thousand titles, and the only honest
 * way to judge one is against the titles the catalogue already publishes. So
 * each candidate is counted twice: how much of the review queue it would clear,
 * and how many playlists already **bound to a course** it would have refused.
 * The second number is the cost, and it has to be zero or nearly so.
 *
 *   pnpm tsx scripts/_markers.ts            # the table
 *   pnpm tsx scripts/_markers.ts tutorial   # and what it hits, on both sides
 */
import { openDb } from './lib/db.js';
import { loadSources } from './lib/sources.js';

const wanted = process.argv[2];

/** Word-boundary, case-insensitive, both alphabets. */
const at = (title: string, phrase: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${phrase}(?![\\p{L}\\p{N}])`, 'iu').test(title);

const CANDIDATES = [
  'tutorial|tutorials|туториал',
  'how to|how-to|как сделать',
  'vlog|vlogs|влог',
  'unboxing|обзор товара',
  'workout|fitness|йога|тренировка',
  'recipe|recipes|рецепт|cooking',
  'gaming|minecraft|fortnite|roblox|стрим',
  'live stream|livestream|прямой эфир|стрим',
  'webinar|вебинар',
  'meetup|conf|conference \\d{4}|gophercon|devfest',
  'sermon|worship|проповедь|молитва',
  'news|новости|weather',
  'travel|путешеств\\p{L}*',
  'beginners|for beginners|с нуля',
  'crash course',
  'masterclass|мастер-класс',
  'hackathon|bootcamp',
  'certification|exam prep|сертификация',
  'demo|demos|showcase',
  'best of|top \\d+',
  'ringtones?|jukebox|karaoke|remix|mixtape',
  'quiz|quizzes|викторина',
  'related videos|related content|facts|подборка',
  'latin music|latin flow|latin love|reggaeton|salsa',
  'brain games|game show|shorts',
  'trailer|teaser|интервью',
  'full course|complete course|полный курс',
  'ege|егэ|огэ|дз|домашн\\p{L}*',
];

const sources = loadSources();
const overridden = new Set(Object.keys(sources.overrides.matches));
const db = openDb({ readonly: true });

type Row = { id: string; title: string; course_id: string | null; confidence: number | null;
             reviewed: number | null; refused: number | null };
const rows = (
  db
    .prepare(
      `SELECT p.id, p.title, m.course_id, m.confidence, m.reviewed, m.refused
       FROM playlists p LEFT JOIN matches m ON m.playlist_id = p.id
       WHERE p.alive = 1 AND p.title IS NOT NULL AND p.title <> ''`
    )
    .all() as Row[]
).filter((row) => !overridden.has(row.id));

const published = rows.filter(
  (row) => row.course_id && (row.reviewed === 1 || (row.confidence ?? 0) >= 0.75)
);
const queue = rows.filter(
  (row) =>
    !(row.course_id && (row.reviewed === 1 || (row.confidence ?? 0) >= 0.75)) &&
    row.reviewed !== 1 &&
    (row.refused ?? 0) === 0
);

console.log(`queue ${queue.length}, published ${published.length}\n`);
console.log('  clears  costs  marker');
for (const candidate of CANDIDATES) {
  if (wanted && !candidate.includes(wanted)) continue;
  const hitsQueue = queue.filter((row) => at(row.title, candidate));
  const hitsPublished = published.filter((row) => at(row.title, candidate));
  console.log(
    `${String(hitsQueue.length).padStart(8)}${String(hitsPublished.length).padStart(7)}  ${candidate}`
  );
  if (!wanted) continue;
  console.log('\n  — would clear:');
  for (const row of hitsQueue.slice(0, 25)) console.log(`     ${row.title.slice(0, 90)}`);
  console.log('\n  — would cost (already in the catalogue):');
  for (const row of hitsPublished.slice(0, 25))
    console.log(`     ${row.course_id?.padEnd(24)} ${row.title.slice(0, 70)}`);
}
db.close();
