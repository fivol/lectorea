/**
 * Scratch: would this catalogue ever have found this playlist by itself?
 *
 *   pnpm tsx scripts/_reachable.ts <link|PL…>              # free: cache, rules, questions asked
 *   pnpm tsx scripts/_reachable.ts <link|PL…> --meta       # + what YouTube says it is (1 unit)
 *   pnpm tsx scripts/_reachable.ts <link|PL…> --ask        # + run the questions (100 units each)
 *   pnpm tsx scripts/_reachable.ts <link|PL…> --course=general-chemistry --ask --budget=1200
 *
 * Somebody sends a link and it is not in the catalogue. The interesting half of
 * that is never the playlist — `pnpm playlist:add` settles the playlist in one
 * unit — it is **why nothing here had reached it**, because whatever the reason
 * is, it is holding back everything shaped like it. This script asks the four
 * questions that separate the reasons, cheapest first:
 *
 *   1. **Has it been seen?** A row in `playlists` means the crawl found it and
 *      something later declined it; no row means no seam ever led here.
 *   2. **Would the rules bind it?** `judgeByRules` on the title, exactly as
 *      `05-match.ts` would — and the four ways of saying no are four different
 *      problems ([lib/rules.ts](lib/rules.ts)).
 *   3. **What would we ever ask about its course?** Every question `_hunt.ts`
 *      would put to YouTube, and which of them the `searches` table says have
 *      already been paid for.
 *   4. **Do those questions actually return it?** `--ask` runs them, at 100
 *      units apiece, and reports where in the answers the playlist appears.
 *
 * Steps 2 and 4 together are the point, because they fail in ways that look
 * alike from the outside and are fixed in different files. «Полный курс
 * школьной химии» was *found* — it is the 21st of the 50 answers to «Общая
 * химия лекции», the one question `general-chemistry` had ever been asked —
 * and then dropped at the hunt's vetting, which refuses `unclaimed` titles
 * because the rule pass reads nothing but the title and no later run would
 * decide differently. Search was working; the keywords were not. Reading the
 * two answers side by side is what says whether to edit
 * [lib/questions.ts](lib/questions.ts) or `data/keywords/*.json`.
 *
 * **What `--ask` deliberately does not do is write the questions down.** The
 * `searches` table is the receipt that stops two hunts buying the same first
 * page, and it is written on the answer: a row there tells `_hunt.ts` the
 * question is settled and its candidates are queued. This script vets nothing
 * and queues nothing, so recording its questions would make the hunt skip them
 * and lose the answers for good. A diagnostic pays for its own answer twice,
 * on purpose — which is also why `--ask` is a flag and not the default.
 *
 * The runbook this belongs to: docs/agents/iteration.md § a link arrives.
 */
import { openDb, type PlaylistRow } from './lib/db.js';
import { reportRunError } from './lib/exit.js';
import { playlistIdFrom } from './lib/playlist-id.js';
import { qualifiersFor, searchNames } from './lib/questions.js';
import { buildKeywordIndex, judgeByRules } from './lib/rules.js';
import { loadAliases, loadDictionary, loadSources } from './lib/sources.js';
import { createClient, QuotaExceededError, SEARCH_COST } from './lib/youtube.js';

const LANGS = ['ru', 'en'];
const REGION: Record<string, string> = { ru: 'RU', en: 'US' };

type Args = { playlistId: string; courseId?: string; meta: boolean; ask: boolean; budget: number };

function parseArgs(argv: string[]): Args {
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const input = argv.find((a) => !a.startsWith('--'));
  const playlistId = input && playlistIdFrom(input);
  if (!playlistId) {
    throw new Error('Usage: pnpm tsx scripts/_reachable.ts <link|PL…> [--course=id] [--meta] [--ask]');
  }
  return {
    playlistId,
    courseId: flag('course'),
    meta: argv.includes('--meta') || argv.includes('--ask'),
    ask: argv.includes('--ask'),
    budget: Number(flag('budget') ?? 1200) || 1200,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sources = loadSources();
  const db = openDb();
  const api = createClient(db, { allowSearch: true });

  /* ─── 1. has it been seen ─────────────────────────────────────────────── */

  let row = db.prepare(`SELECT * FROM playlists WHERE id = ?`).get(args.playlistId) as
    | PlaylistRow
    | undefined;
  const override = sources.overrides.matches[args.playlistId];
  const match = db.prepare(`SELECT * FROM matches WHERE playlist_id = ?`).get(args.playlistId) as
    | { course_id: string | null; confidence: number; reviewed: number }
    | undefined;
  const verdict = db.prepare(`SELECT * FROM verdicts WHERE playlist_id = ?`).get(args.playlistId) as
    | { verdict: string; course_id: string | null }
    | undefined;

  console.log(`\n▸ ${args.playlistId}`);
  console.log(`  в кэше:       ${row ? `да — «${row.title ?? '—'}», ${row.video_count ?? '?'} видео` : 'НЕТ, ни разу не видели'}`);
  console.log(`  overrides:    ${override === undefined ? '—' : JSON.stringify(override)}`);
  console.log(
    `  matches:      ${match ? `${match.course_id ?? '—'} @ ${match.confidence}${match.reviewed ? ' (reviewed)' : ''}` : '—'}`
  );
  console.log(`  verdict:      ${verdict ? `${verdict.verdict}${verdict.course_id ? ` (${verdict.course_id})` : ''}` : '—'}`);

  // A playlist nothing has ever seen has no title to judge, so buy the one
  // call that gives it: 1 unit, and every question below reads it.
  if (!row && args.meta) {
    const [meta] = await api.playlists([args.playlistId]);
    if (meta) {
      row = {
        id: meta.id,
        title: meta.snippet.title,
        description: meta.snippet.description,
        video_count: meta.contentDetails.itemCount,
        channel_id: meta.snippet.channelId,
      } as PlaylistRow;
      console.log(
        `  youtube:      «${meta.snippet.title}» · ${meta.contentDetails.itemCount} видео · ${meta.snippet.channelTitle}`
      );
    } else {
      console.log('  youtube:      не найден или закрыт');
    }
  }

  /* ─── 2. would the rules bind it ──────────────────────────────────────── */

  if (row?.title) {
    const index = buildKeywordIndex(sources);
    const ruled = judgeByRules(row, index);
    console.log(`\n▸ правила по названию «${row.title}»`);
    console.log(`  ${JSON.stringify(ruled)}`);
    if (ruled.kind === 'match' && ruled.confidence < 0.75) {
      console.log('  · ниже 0.75 — в очередь ревью, в каталог само не попадёт');
    }
    if (ruled.kind === 'unclaimed') {
      console.log('  · ни одно ключевое слово не названо: правилам нечего добавить в data/keywords');
    }
  } else if (!args.meta) {
    console.log('\n· названия нет — прогоните с --meta (1 юнит), иначе правила судить не о чем');
  }

  /* ─── 3. what would we ever ask about its course ──────────────────────── */

  const courseId =
    args.courseId ??
    (Array.isArray(override) ? override[0] : (override as string | undefined)) ??
    match?.course_id ??
    undefined;

  if (!courseId) {
    console.log('\n· курс неизвестен — передайте --course=<id>, иначе вопросы не из чего собрать');
    db.close();
    return;
  }

  const course = sources.courses.find((c) => c.id === courseId);
  const stage = course?.stage;
  const asked = new Set(
    (db.prepare(`SELECT id FROM searches`).all() as Array<{ id: string }>).map((r) => r.id)
  );

  type Question = { lang: string; q: string; asked: boolean };
  const questions: Question[] = [];
  for (const lang of LANGS) {
    const i18n = loadDictionary(lang);
    const aliases = loadAliases(lang);
    for (const name of searchNames(
      i18n[`course.${courseId}.title`],
      aliases[`course.${courseId}`] ?? [],
      stage
    )) {
      for (const qualifier of qualifiersFor(lang, stage)) {
        const q = `${name} ${qualifier}`.trim();
        const key = `playlist:${q.toLowerCase()}`;
        if (questions.some((question) => question.q.toLowerCase() === q.toLowerCase())) continue;
        questions.push({ lang, q, asked: asked.has(key) });
      }
    }
  }

  console.log(`\n▸ вопросы, которые _hunt.ts задаёт про ${courseId} (stage: ${stage ?? '—'})`);
  for (const question of questions) {
    console.log(`  ${question.asked ? 'спрошен ' : '        '} [${question.lang}] «${question.q}»`);
  }
  console.log(`  ${questions.filter((question) => question.asked).length} из ${questions.length} уже оплачены`);

  /* ─── 4. do those questions actually return it ────────────────────────── */

  if (!args.ask) {
    console.log('\n· --ask прогонит их по-настоящему (100 юнитов за вопрос) и скажет, есть ли в ответах');
    db.close();
    return;
  }

  console.log(`\n▸ ответы (бюджет ${args.budget} юнитов)`);
  const before = api.spent();
  let found = 0;
  for (const question of questions) {
    if (api.spent() - before + SEARCH_COST > args.budget) {
      console.log(`  · бюджет исчерпан, не спрошено: ${questions.length - questions.indexOf(question)}`);
      break;
    }
    try {
      const hits = await api.search(question.q, {
        kind: 'playlist',
        lang: question.lang,
        region: REGION[question.lang],
      });
      const at = hits.findIndex((hit) => hit.id === args.playlistId);
      if (at !== -1) found += 1;
      console.log(
        `  ${at === -1 ? ' нет ' : `#${String(at + 1).padStart(2)} `} ${String(hits.length).padStart(2)} ответов · «${question.q}»`
      );
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        console.log('  · квота кончилась — остановились на том, что успели');
        break;
      }
      console.log(`  ✗ «${question.q}»: ${String(error)}`);
    }
  }

  console.log(
    found
      ? `\n✓ ${found} из наших вопросов возвращают этот плейлист — пайплайн до него дошёл бы`
      : '\n✗ ни один наш вопрос его не возвращает — правьте lib/questions.ts или имена курса, а не только этот плейлист'
  );
  console.log(`· потрачено: ${api.spent() - before}, осталось ${api.remaining()}`);
  db.close();
}

main().catch((error) => {
  reportRunError(error);
  process.exit(1);
});
