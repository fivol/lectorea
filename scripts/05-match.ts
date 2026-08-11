import { nowIso, parseLimit, reportRemaining } from './lib/config.js';
import { openDb, type Db, type PlaylistRow } from './lib/db.js';
import { loadSources, reportSourceError, type Sources } from './lib/sources.js';
import { hasOpenAI, MODELS, openai } from './lib/openai.js';
import { normalize } from '../shared/search.js';

/**
 * Binding a playlist to a course — the most laborious step, and the one that
 * does not fully automate.
 *
 * A cascade, cheapest first:
 *   1. rules  — regex and the synonym dictionary from keywords/{lang}.json
 *   2. LLM    — title, description and the first lecture names, in batches of 20
 *   3. human  — anything under the confidence threshold lands in `06-review.ts`
 */

const CONFIDENCE_THRESHOLD = 0.75;
const RULE_EXACT = 0.9;

type Candidate = { courseId: string; confidence: number; method: 'rule' | 'llm' };

async function main(): Promise<void> {
  const useLlm = process.argv.includes('--llm');
  const limit = parseLimit();
  const sources = loadSources();
  const db = openDb();

  const allPending = unmatchedPlaylists(db, sources);
  const pending = allPending.slice(0, limit);
  console.log(`· ${allPending.length} playlists without a confident match`);
  if (!pending.length) {
    db.close();
    return;
  }

  const index = buildKeywordIndex(sources);
  const write = db.prepare(
    `INSERT INTO matches (playlist_id, course_id, confidence, method, reviewed, updated_at)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(playlist_id) DO UPDATE SET
       course_id = excluded.course_id,
       confidence = excluded.confidence,
       method = excluded.method,
       updated_at = excluded.updated_at
     WHERE matches.reviewed = 0`
  );

  /**
   * Records that a pass looked at this playlist and came away with nothing.
   * Only `updated_at` moves, so a weak guess from an earlier pass survives —
   * but the playlist sorts to the back of the queue, which is what lets a
   * limited run continue with different playlists instead of the same ones.
   */
  const touch = db.prepare(
    `INSERT INTO matches (playlist_id, course_id, confidence, method, reviewed, updated_at)
     VALUES (?, NULL, 0, ?, 0, ?)
     ON CONFLICT(playlist_id) DO UPDATE SET updated_at = excluded.updated_at
     WHERE matches.reviewed = 0`
  );

  let byRule = 0;
  const unresolved: PlaylistRow[] = [];

  for (const playlist of pending) {
    const candidate = matchByRules(playlist, index);
    if (candidate) {
      write.run(playlist.id, candidate.courseId, candidate.confidence, candidate.method, nowIso());
      byRule += 1;
    } else {
      touch.run(playlist.id, 'rules-none', nowIso());
      unresolved.push(playlist);
    }
  }
  console.log(`· rules matched ${byRule}, ${unresolved.length} left`);
  reportRemaining(allPending.length - pending.length, limit);

  if (!unresolved.length) {
    db.close();
    return;
  }
  if (!useLlm) {
    console.log('· run with --llm to classify the rest, then `pnpm data:review` for the leftovers');
    db.close();
    return;
  }
  if (!hasOpenAI()) {
    console.log('· OPENAI_API_KEY is not set — skipping LLM, the rest goes to manual review');
    db.close();
    return;
  }

  let byLlm = 0;
  const courses = sources.courses.map((course) => ({
    id: course.id,
    title: sources.i18n[`course.${course.id}.title`] ?? course.id,
  }));

  for (let i = 0; i < unresolved.length; i += 20) {
    const batch = unresolved.slice(i, i + 20);
    const answers = await classifyBatch(db, batch, courses);
    for (const answer of answers) {
      if (!answer.courseId) {
        touch.run(answer.playlistId, 'llm-none', nowIso());
        continue;
      }
      write.run(answer.playlistId, answer.courseId, answer.confidence, 'llm', nowIso());
      byLlm += 1;
    }
    console.log(`  classified ${Math.min(i + 20, unresolved.length)}/${unresolved.length}`);
  }

  console.log(`✓ data:match: ${byRule} by rule, ${byLlm} by model`);
  console.log('· anything below 0.75 stays out of the catalogue until reviewed');
  db.close();
}

/* ──────────────────────────────  Rule matching  ────────────────────────── */

type KeywordIndex = Array<{ courseId: string; phrase: string }>;

/**
 * Longest phrases first: «теория вероятностей» must win over «вероятность»,
 * otherwise every probability course collapses into the same match.
 */
function buildKeywordIndex(sources: Sources): KeywordIndex {
  const index: KeywordIndex = [];
  for (const course of sources.courses) {
    const phrases = new Set<string>();
    const title = sources.i18n[`course.${course.id}.title`];
    if (title) phrases.add(normalize(title));
    for (const keyword of sources.keywords[`course.${course.id}`] ?? []) {
      phrases.add(normalize(keyword));
    }
    for (const phrase of phrases) {
      // Two-letter keywords match everything; they are only useful in search.
      if (phrase.length >= 4) index.push({ courseId: course.id, phrase });
    }
  }
  return index.sort((a, b) => b.phrase.length - a.phrase.length);
}

function matchByRules(playlist: PlaylistRow, index: KeywordIndex): Candidate | null {
  const title = normalize(playlist.title);
  if (!title) return null;

  const hits = index.filter((entry) => title.includes(entry.phrase));
  if (!hits.length) return null;

  const best = hits[0];
  // More than one course claiming the same title is exactly the ambiguous case
  // a human should look at, so it is handed over rather than guessed.
  const competing = new Set(
    hits.filter((hit) => hit.phrase.length === best.phrase.length).map((hit) => hit.courseId)
  );
  if (competing.size > 1) return null;

  const exact = title === best.phrase || title.startsWith(`${best.phrase} `);
  return {
    courseId: best.courseId,
    confidence: exact ? RULE_EXACT : 0.6,
    method: 'rule',
  };
}

/* ──────────────────────────────  LLM matching  ─────────────────────────── */

type LlmAnswer = { playlistId: string; courseId: string | null; confidence: number };

async function classifyBatch(
  db: Db,
  playlists: PlaylistRow[],
  courses: Array<{ id: string; title: string }>
): Promise<LlmAnswer[]> {
  const lectures = db.prepare(
    `SELECT title FROM videos WHERE playlist_id = ? ORDER BY position LIMIT 5`
  );

  const items = playlists.map((playlist) => ({
    id: playlist.id,
    title: playlist.title,
    channel: playlist.channel_id,
    description: (playlist.description ?? '').slice(0, 400),
    lectures: (lectures.all(playlist.id) as Array<{ title: string }>).map((row) => row.title),
  }));

  const prompt = [
    'Ты сопоставляешь плейлисты YouTube с университетскими курсами.',
    'Для каждого плейлиста выбери РОВНО ОДИН courseId из списка или ответь null,',
    'если плейлист не является полноценным курсом по одной из этих тем',
    '(разрозненные ролики, популярные лекции, реклама — это null).',
    '',
    'Курсы:',
    ...courses.map((course) => `${course.id}: ${course.title}`),
    '',
    'Плейлисты:',
    JSON.stringify(items, null, 1),
    '',
    'Ответь JSON-массивом: [{"playlistId": "...", "courseId": "..." | null, "confidence": 0..1}]',
  ].join('\n');

  const response = await openai().chat.completions.create({
    model: MODELS.classify,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });

  const text = response.choices[0]?.message?.content ?? '{}';
  try {
    const parsed = JSON.parse(text) as { results?: LlmAnswer[] } | LlmAnswer[];
    const list = Array.isArray(parsed) ? parsed : (parsed.results ?? []);
    const valid = new Set(courses.map((course) => course.id));
    return list
      .filter((answer) => !answer.courseId || valid.has(answer.courseId))
      .map((answer) => ({
        ...answer,
        confidence: Math.min(1, Math.max(0, answer.confidence ?? 0)),
      }));
  } catch {
    console.warn('  model returned something that is not JSON — batch skipped');
    return [];
  }
}

/* ────────────────────────────────  Selection  ──────────────────────────── */

/**
 * Never-tried playlists first, then the ones tried longest ago. Without an
 * order a limited run would keep re-reading the same head of the list, and
 * `pnpm data:match 20` twice would classify the same twenty twice.
 */
function unmatchedPlaylists(db: Db, sources: Sources): PlaylistRow[] {
  const overridden = new Set(Object.keys(sources.overrides.matches));
  const rows = db
    .prepare(
      `SELECT p.* FROM playlists p
       LEFT JOIN matches m ON m.playlist_id = p.id
       WHERE p.alive = 1
         AND (m.playlist_id IS NULL OR (m.reviewed = 0 AND m.confidence < ?))
       ORDER BY m.updated_at IS NULL DESC, m.updated_at, p.id`
    )
    .all(CONFIDENCE_THRESHOLD) as PlaylistRow[];
  return rows.filter((row) => !overridden.has(row.id));
}

main().catch(reportSourceError);
