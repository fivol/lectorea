import { nowIso, parseLimit, reportRemaining } from './lib/config.js';
import { MATCH_THRESHOLD, openDb, type Db, type PlaylistRow } from './lib/db.js';
import { loadSources, type Sources } from './lib/sources.js';
import { reportRunError } from './lib/exit.js';
import { hasOpenAI, MODELS, openai } from './lib/openai.js';
import { buildKeywordIndex, matchByRules } from './lib/rules.js';

/**
 * Binding a playlist to a course — the most laborious step, and the one that
 * does not fully automate.
 *
 * A cascade, cheapest first:
 *   1. rules  — the synonym dictionary from keywords/{lang}.json, see lib/rules.ts
 *   2. LLM    — title, description and the first lecture names, in batches of 20
 *   3. human  — anything under the confidence threshold lands in `06-review.ts`
 *
 * `--force` re-reads everything the passes decided before, which is what a
 * change to the rules or the keywords needs to reach the catalogue.
 */

async function main(): Promise<void> {
  const useLlm = process.argv.includes('--llm');
  const force = process.argv.includes('--force');
  const limit = parseLimit();
  const sources = loadSources();
  const db = openDb();

  const allPending = unmatchedPlaylists(db, sources, force);
  const pending = allPending.slice(0, limit);
  console.log(
    force
      ? `· ${allPending.length} playlists to re-read against the current rules`
      : `· ${allPending.length} playlists without a confident match`
  );
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
  /** What the rules got, for the ones too weak to ship. The model has to beat it. */
  const ruleFloor = new Map<string, number>();

  for (const playlist of pending) {
    const candidate = matchByRules(playlist, index);
    if (candidate) {
      write.run(playlist.id, candidate.courseId, candidate.confidence, 'rule', nowIso());
      byRule += 1;
    }
    // A forced pass must be able to take a binding back: the rule that made it
    // may be the one that changed. Without this an improved matcher can only
    // ever add, and the wrong bindings it was written to remove stay put.
    if (!candidate && force) write.run(playlist.id, null, 0, 'rules-none', nowIso());
    else if (!candidate) touch.run(playlist.id, 'rules-none', nowIso());
    // A guess under the threshold does not reach the catalogue, so it is not an
    // answer — it is a hint, and the model gets it too. Passing on only outright
    // refusals left every «passing mention» title for a human, which is the tier
    // the cascade is meant to spend last.
    if (!candidate || candidate.confidence < MATCH_THRESHOLD) {
      unresolved.push(playlist);
      if (candidate) ruleFloor.set(playlist.id, candidate.confidence);
    }
  }
  console.log(
    `· rules matched ${byRule} (${byRule - ruleFloor.size} confident), ` +
      `${unresolved.length} left`
  );
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
      // A weaker answer than the rules already gave is not an improvement, and
      // overwriting would lose the better guess a reviewer is shown first.
      if (!answer.courseId || answer.confidence <= (ruleFloor.get(answer.playlistId) ?? 0)) {
        touch.run(answer.playlistId, 'llm-none', nowIso());
        continue;
      }
      write.run(answer.playlistId, answer.courseId, answer.confidence, 'llm', nowIso());
      byLlm += 1;
    }
    console.log(`  classified ${Math.min(i + 20, unresolved.length)}/${unresolved.length}`);
  }

  console.log(`✓ data:match: ${byRule} by rule, ${byLlm} by model`);
  console.log(`· anything below ${MATCH_THRESHOLD} stays out of the catalogue until reviewed`);
  db.close();
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
 *
 * `force` also re-reads the ones an earlier pass bound confidently. A change to
 * the rules is otherwise invisible to everything already in the catalogue —
 * exactly the bindings a rule was improved to correct — since a confident row
 * is the one thing this query normally leaves alone. Hand decisions are still
 * never touched: `reviewed` rows and `overrides.yaml` outrank any pass.
 */
function unmatchedPlaylists(db: Db, sources: Sources, force = false): PlaylistRow[] {
  const overridden = new Set(Object.keys(sources.overrides.matches));
  const rows = db
    .prepare(
      `SELECT p.* FROM playlists p
       LEFT JOIN matches m ON m.playlist_id = p.id
       WHERE p.alive = 1
         AND (m.playlist_id IS NULL OR m.reviewed = 0 AND (? OR m.confidence < ?))
       ORDER BY m.updated_at IS NULL DESC, m.updated_at, p.id`
    )
    .all(force ? 1 : 0, MATCH_THRESHOLD) as PlaylistRow[];
  return rows.filter((row) => !overridden.has(row.id));
}

main().catch(reportRunError);
