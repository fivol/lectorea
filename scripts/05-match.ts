import { nowIso, parseLimit, reportRemaining } from './lib/config.js';
import { MATCH_THRESHOLD, openDb, type Db, type PlaylistRow } from './lib/db.js';
import { loadSources, type Sources } from './lib/sources.js';
import { reportRunError } from './lib/exit.js';
import { hasOpenAI, MODELS, openai } from './lib/openai.js';
import { buildKeywordIndex, judgeByRules, type RuleCandidate } from './lib/rules.js';

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
    `INSERT INTO matches (playlist_id, course_id, confidence, method, reviewed, refused, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?)
     ON CONFLICT(playlist_id) DO UPDATE SET
       course_id = excluded.course_id,
       confidence = excluded.confidence,
       method = excluded.method,
       -- A verdict replaces the one before it whole: a refusal left standing
       -- under a fresh binding is two answers at once, and the queue would then
       -- skip a playlist the catalogue is showing.
       refused = 0,
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

  /**
   * Records that a pass judged this to be no course at all — «Best Pop Songs
   * Playlist», «homework walkthroughs», «Дни открытых дверей».
   *
   * The difference from `touch` is what happens next. A pass that can only ever
   * say yes leaves a queue that only grows: 35 148 playlists were waiting for a
   * human on 2026-08-15, and the overwhelming majority of them were music
   * videos mined out of a description. Nobody will ever read that queue, so the
   * few hundred real questions in it are lost inside it — and every later run
   * pays the model again to re-read the same karaoke.
   *
   * A refusal is therefore an answer and is stored as one: out of the review
   * queue, out of the next model batch, and last in the video queue, where the
   * bins that cost the most quota belong. It stays reversible — `--force`
   * re-reads refusals like any other pass verdict, which is what a new course
   * or a new keyword needs — and it never outranks a person: `reviewed` rows
   * and `overrides.yaml` are untouched by any of this.
   */
  const refuse = db.prepare(
    `INSERT INTO matches (playlist_id, course_id, confidence, method, reviewed, refused, updated_at)
     VALUES (?, NULL, 0, ?, 0, 1, ?)
     ON CONFLICT(playlist_id) DO UPDATE SET
       course_id = NULL,
       confidence = 0,
       method = excluded.method,
       refused = 1,
       updated_at = excluded.updated_at
     WHERE matches.reviewed = 0`
  );

  let byRule = 0;
  let byRefusal = 0;
  const unresolved: PlaylistRow[] = [];
  /**
   * What the rules got, for the ones too weak to ship. The model is shown it as
   * a hint and has to beat it to replace it — a guess under the threshold is not
   * an answer, but it is the best thing anyone has said about that title, and
   * withholding it made the model re-derive it from the same words.
   */
  const ruleFloor = new Map<string, RuleCandidate>();

  for (const playlist of pending) {
    const verdict = judgeByRules(playlist, index);
    const candidate = verdict.kind === 'match' ? verdict : null;
    if (candidate) {
      write.run(playlist.id, candidate.courseId, candidate.confidence, 'rule', nowIso());
      byRule += 1;
    }
    // The title says it is not a course. That is a decision, not an absence of
    // one, so it is written down and the playlist stops coming round.
    if (verdict.kind === 'not-a-course') {
      refuse.run(playlist.id, 'rules-not-a-course', nowIso());
      byRefusal += 1;
      continue;
    }
    // No course of this catalogue is named in the title at all — in either
    // language, by any of its names. That is a different thing from a title
    // this pass could not settle, and it is not a question a reviewer can
    // answer: `data:review` offers course suggestions, and there are none to
    // offer. What such a title needs is a keyword or a course, and those are
    // found by reading the titles in clusters — `_refusals.ts no-phrase`, which
    // reads them off the rules and goes on seeing refused rows.
    //
    // So it is recorded, and the review queue keeps only what a person can
    // decide: of the 33 376 still waiting after the crawl of 2026-08-15 had
    // recorded its support-material refusals, 24 808 named nothing at all, and
    // the 8568 that did were invisible inside them. Reversible in the two ways it
    // needs to be — `--force` after a keyword or a course is added, and
    // `01-discover.ts` when a channel is vetted.
    if (verdict.kind === 'unclaimed') {
      refuse.run(playlist.id, 'unclaimed', nowIso());
      byRefusal += 1;
      continue;
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
      if (candidate) ruleFloor.set(playlist.id, candidate);
    }
  }
  console.log(
    `· rules matched ${byRule} (${byRule - ruleFloor.size} confident), ` +
      `refused ${byRefusal} as not a course, ${unresolved.length} left`
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
  // The domain travels with the name because the id does not carry it reliably
  // and the title alone cannot say which shelf a course sits on: `topology`
  // reads the same whether the catalogue files it under mathematics or under
  // geography, and the model is choosing between 186 of them.
  const courses = sources.courses.map((course) => ({
    id: course.id,
    title: sources.i18n[`course.${course.id}.title`] ?? course.id,
    domain: course.domains?.[0] ?? '',
  }));

  const batches: PlaylistRow[][] = [];
  for (let i = 0; i < unresolved.length; i += BATCH) batches.push(unresolved.slice(i, i + BATCH));

  let done = 0;
  const apply = (answers: LlmAnswer[], batch: PlaylistRow[]): void => {
    for (const answer of answers) {
      // The model read the title, the description and the first five lectures
      // and says this is none of the catalogue's courses. Nothing cheaper will
      // ever say otherwise, so it is recorded — see `refuse` above for why an
      // unrecorded «no» is what made the queue unreadable.
      if (!answer.courseId) {
        refuse.run(answer.playlistId, 'llm-not-a-course', nowIso());
        byRefusal += 1;
        continue;
      }
      // A weaker answer than the rules already gave is not an improvement, and
      // overwriting would lose the better guess a reviewer is shown first. It
      // is also not a refusal: two passes disagreeing about which course is
      // exactly the question a human is kept for.
      if (answer.confidence <= (ruleFloor.get(answer.playlistId)?.confidence ?? 0)) {
        touch.run(answer.playlistId, 'llm-none', nowIso());
        continue;
      }
      write.run(answer.playlistId, answer.courseId, answer.confidence, 'llm', nowIso());
      byLlm += 1;
    }
    done += batch.length;
    if (done % (BATCH * 10) < BATCH) console.log(`  classified ${done}/${unresolved.length}`);
  };

  // Batches in parallel, for the same reason the crawl runs six jobs at once:
  // one request at a time is bound by the round trip rather than by anything
  // else, and thirty thousand playlists is 1500 requests. Serially that is a
  // working day of wall clock for a step whose whole point is that it does not
  // need one.
  let next = 0;
  await Promise.all(
    Array.from({ length: LLM_CONCURRENCY }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        try {
          apply(await classifyBatch(db, batch, courses, ruleFloor), batch);
        } catch (error) {
          // One batch of twenty is not worth ending a run of fifteen hundred
          // over: the playlists keep their place in the queue and the next run
          // takes them again.
          console.warn(`  batch failed, left for the next run: ${(error as Error).message}`);
          done += batch.length;
        }
      }
    })
  );

  console.log(
    `· model tokens: ${tokens.prompt.toLocaleString('en-US')} in, ` +
      `${tokens.completion.toLocaleString('en-US')} out, over ${batches.length} requests`
  );
  console.log(`✓ data:match: ${byRule} by rule, ${byLlm} by model, ${byRefusal} refused`);
  console.log(`· anything below ${MATCH_THRESHOLD} stays out of the catalogue until reviewed`);
  console.log('· a refusal is reversible: `--force` re-reads them, which is what a new course needs');
  db.close();
}

/* ──────────────────────────────  LLM matching  ─────────────────────────── */

/** Playlists per request. Twenty fits comfortably beside 200 course names. */
const BATCH = 20;

/**
 * Requests in flight. Six is the crawl's number for the same reason — enough to
 * stop waiting on round trips, few enough not to be asking too fast.
 */
const LLM_CONCURRENCY = 6;

/** What the run cost, so the number is in the log rather than in a bill. */
const tokens = { prompt: 0, completion: 0 };

type LlmAnswer = { playlistId: string; courseId: string | null; confidence: number };

async function classifyBatch(
  db: Db,
  playlists: PlaylistRow[],
  courses: Array<{ id: string; title: string; domain: string }>,
  ruleFloor: Map<string, RuleCandidate>
): Promise<LlmAnswer[]> {
  const lectures = db.prepare(
    `SELECT title FROM videos WHERE playlist_id = ? ORDER BY position LIMIT 5`
  );
  // The channel by name, not by id. `UC7T8roVtC_3afWKTOGtLLBg` says nothing to
  // a model and cost a fifth of every item's tokens; «МФТИ — Физтех» is half of
  // what a person reads before deciding.
  const channel = db.prepare(`SELECT title FROM channels WHERE id = ?`);

  const items = playlists.map((playlist) => ({
    id: playlist.id,
    title: playlist.title,
    channel:
      (channel.get(playlist.channel_id ?? '') as { title: string } | undefined)?.title ??
      playlist.channel_id,
    videos: playlist.video_count,
    description: (playlist.description ?? '').slice(0, 400),
    lectures: (lectures.all(playlist.id) as Array<{ title: string }>).map((row) => row.title),
    // What the rules made of it, when they made anything. Below the threshold
    // it is a hint rather than an answer — but it is what a reviewer would be
    // shown first, and the model has to beat it to replace it.
    guess: ruleFloor.get(playlist.id)?.courseId,
  }));

  const prompt = [
    'Ты сопоставляешь плейлисты YouTube с курсами каталога университетских лекций.',
    'Для каждого плейлиста выбери РОВНО ОДИН courseId из списка или ответь null.',
    '',
    'Единица каталога — курс целиком: семестр лекций или семинаров по предмету.',
    'Отвечай null, если плейлист:',
    '· не учебный (музыка, клипы, влоги, мультфильмы, игры, реклама, подкасты);',
    '· не относится ни к одной теме из списка — даже если это хороший курс;',
    '· является частью курса (одна глава, одна тема, один раздел), а не курсом;',
    '· является сборной солянкой канала («все видео», «семинары», конференция);',
    '· это отдельная лекция, доклад, интервью или запись мероприятия.',
    '',
    'Язык плейлиста не имеет значения: курс на хинди, португальском или русском',
    'сопоставляется с тем же courseId, что и английский.',
    'Уровень имеет значение: школьный курс не сопоставляется с университетским.',
    '',
    'confidence — насколько ты уверен: 0.9 и выше только когда название прямо',
    'называет предмет курса, 0.5–0.7 когда вывод сделан по описанию или лекциям.',
    '',
    'Курсы (courseId · название · область):',
    ...courses.map((course) => `${course.id} · ${course.title} · ${course.domain}`),
    '',
    'Плейлисты (guess — догадка правил, её нужно превзойти, чтобы заменить):',
    JSON.stringify(items, null, 1),
    '',
    'Ответь JSON: {"results": [{"playlistId": "...", "courseId": "..." | null, "confidence": 0..1}]}',
    'Ровно один элемент на каждый плейлист, в том же порядке.',
  ].join('\n');

  const response = await openai().chat.completions.create({
    model: MODELS.classify,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });
  tokens.prompt += response.usage?.prompt_tokens ?? 0;
  tokens.completion += response.usage?.completion_tokens ?? 0;

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
 * `force` also re-reads the ones an earlier pass bound confidently, and the
 * ones a pass refused as not a course. A change to the rules is otherwise
 * invisible to everything already decided — exactly the bindings a rule was
 * improved to correct — since a settled row is the one thing this query
 * normally leaves alone. Hand decisions are still never touched: `reviewed`
 * rows and `overrides.yaml` outrank any pass.
 */
function unmatchedPlaylists(db: Db, sources: Sources, force = false): PlaylistRow[] {
  const overridden = new Set(Object.keys(sources.overrides.matches));
  const rows = db
    .prepare(
      `SELECT p.* FROM playlists p
       LEFT JOIN matches m ON m.playlist_id = p.id
       WHERE p.alive = 1
         AND (m.playlist_id IS NULL
              OR m.reviewed = 0 AND (? OR m.confidence < ? AND COALESCE(m.refused, 0) = 0))
       ORDER BY m.updated_at IS NULL DESC, m.updated_at, p.id`
    )
    .all(force ? 1 : 0, MATCH_THRESHOLD) as PlaylistRow[];
  return rows.filter((row) => !overridden.has(row.id));
}

main().catch(reportRunError);
