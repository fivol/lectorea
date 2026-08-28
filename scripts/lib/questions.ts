import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import type { Db } from './db.js';
import { loadAliases, loadDictionary } from './sources.js';
import type { Course } from '../../shared/schema.js';

/**
 * The questions this catalogue asks YouTube about a course.
 *
 * Split out of `_hunt.ts` so that two scripts can agree on what the crawl would
 * ever ask: the hunt spends the questions, and `_reachable.ts` asks whether a
 * playlist somebody sent in is answerable by any of them. A phrasing that lives
 * in one script cannot be checked by the other, and the whole point of the
 * check is that it reads the questions the hunt will really run.
 *
 * Every question here costs 100 units — `search.list`, the one endpoint the
 * crawl does not build on ([docs/pipeline.md](../../docs/pipeline.md#quota)) —
 * so this file is a list of *phrasings*, never of courses: which courses get
 * asked is the hunt's brief, written by the holes in the catalogue.
 */

/**
 * What is appended to a course name to ask for a course rather than a video.
 *
 * A bare subject name returns the best *single video* about it, because that is
 * what most people searching that phrase want. The word for "lectures" is what
 * turns the same query into a list of series — and it is per language, since
 * `relevanceLanguage` biases the ranking without translating the query.
 *
 * More than one, because a course already asked about is not asked again by
 * repeating the question: search ranks by relevance and returns the same first
 * page for the same words, while «поэтика курс» and «поэтика лекции» do not.
 *
 * **This list is the only lever left once the pool of questions is empty.** The
 * pool is one question per course, name, language, phrasing and kind, and by
 * 2026-08-24 every one of the 3084 slots the first three phrasings define had
 * been asked and paid for. A phrasing added here reopens 472 playlist questions
 * — 236 courses in two languages — which is 47 200 units, and that is the
 * arithmetic a day with untouched keys is planned against
 * ([harvest.md](../../docs/harvest.md#the-pool-of-questions-is-finite-and-a-phrasing-is-what-reopens-it)).
 *
 * The last two of each row were added that day, and chosen by measurement
 * rather than by ear: `_yield.ts` reads the saved search bodies and says what
 * each phrasing bought, and a count over the titles of the 9333 published
 * playlists says which words a course names itself with. «семинары» is in 136
 * of them and «основы» in 39; `course` is in 550 and `introduction` in 490, and
 * neither English word had ever been asked on its own — the catalogue had been
 * asking for `full course` and `lecture series` and never for the plain word
 * that half its own material is titled with. Words that score badly on the same
 * count were left out for it: «полный курс» is in six published titles,
 * `university course` in two.
 *
 * The order is the order they are asked in, so anything added goes at the end:
 * the run is variant-major, and the first phrasing of every course is worth
 * more than the fourth phrasing of a third of them.
 *
 * The sixth of each row is 2026-08-27, and it was chosen by the same two counts
 * *and* by the shape the first five had already shown: yield falls with
 * vagueness. `lectures` bought 19.7 bindings per 100 units, `full course` 10.1,
 * the bare `course` 3.9 and «основы» 2.7 — so the words worth adding are the
 * specific, lecture-hall ones, and the tempting large dimension is the wrong
 * one. **A bare course name with no qualifier at all was considered and left
 * out for exactly that:** it is 472 unasked questions and the vaguest possible
 * phrasing, and everything measured says a vague phrasing returns the topic bin
 * rather than the semester. «курс лекций» is in 47 published titles and `class`
 * in 87, and neither is a word order the first five ever asked in.
 *
 * The seventh of the English row is 2026-08-28, and it was chosen on a count the
 * earlier rounds did not have: **how much material a phrasing could name that no
 * existing phrasing already names.** A word is redundant when the titles carrying
 * it also carry one of the six — the query is then a re-ask of one already bought.
 * `complete course` reads well and is in 49 published titles, and **nought** of
 * them are free of the six, because every one of them contains «course»; it was
 * rejected on that alone. `semester` is in 90, and 70 of those carry none of the
 * six — the largest such count of any word that names a lecture hall rather than
 * a mood. The two larger counts, `learn` at 217 and `program` at 116, are also
 * the two vaguest words on the list, and the measured shape of this table is that
 * yield falls with vagueness, so they were left where `course` and «основы» are.
 *
 * **A provider's name is not a phrasing.** `nptel`, `mit`, `iit` and `yale` were
 * considered as the specific, lecture-hall words they plainly are, and refused
 * for a reason that has nothing to do with wording: those channels are already in
 * data/channels.yaml and are crawled whole, so the answers would be ids this
 * cache already holds. A source word is only worth 100 units when the source is
 * one the crawl cannot reach.
 *
 * The eighth is the same day, and it carries a warning about the count itself:
 * **the title count must be word-bounded, or it measures the wrong word.** Read
 * as a substring, `learn` is in 217 published titles and `program` in 116, which
 * would have made them the two largest candidates on the list — and nearly every
 * hit is «machine **learn**ing», «deep **learn**ing» and «C++ **program**ming».
 * Bounded, they are 12 and 5. Two phrasings were nearly bought on an artefact of
 * `String.includes`.
 *
 * That left `playlist` at 79 and `university` at 40, both real. `university` was
 * taken on the seam rather than the count: its titles are Princeton, Stanford,
 * UNSW, Waterloo and NUS, and the refusal rate of a reader round tracks the seam
 * it came from — a faculty channel comes back at 15%, a wide search at 30–46%
 * ([harvest skill](../../.claude/skills/harvest/SKILL.md)). The metric the launch
 * is judged on is *published* English playlists, not queued ones, so a phrasing
 * that names lecture halls is worth more than a larger one that names formats.
 * `playlist` is the runner-up and the first thing to try when this pool empties.
 *
 * The ninth is 2026-08-28 and it is that runner-up, bought at 92 novel titles —
 * «Calculus 1 Playlist», «Machine Learning Playlist», «Computer Networks
 * (Complete Playlist)». 193 questions returned 3130 playlists the cache had never
 * seen and queued 571 of them directly.
 *
 * **Two words were measured against it and refused, and both refusals are worth
 * more than the purchase.**
 *
 * `theory` scored **450 novel titles** — five times any word ever considered
 * here, and the largest count this file has ever produced. It is not a phrasing.
 * Every hit is the word inside a *subject*: «Theory of Computation», «Game
 * Theory», «Graph Theory», «Coding Theory». Appended to a course name it asks
 * «Number theory theory». This is a second way the count lies, distinct from the
 * substring artefact that nearly bought `learn` and `program`: word-bounding
 * fixes the spelling but not the part of speech, and the count cannot tell a word
 * that *names* courses from one that *describes their format*. Only a format word
 * can be appended, so read the sample before believing a large count —
 * `_gaps.ts`-style, twelve titles is enough to see it.
 *
 * `lecture videos` was the opposite case and was refused on a rehearsal. It is
 * specific and lecture-hall, which is the shape this table rewards, but only 15
 * novel titles carry it. 50 questions bought **69 queued playlists — 1.38 per
 * question — against `playlist`'s 3.88 on the identical thinnest-first slice of
 * the same brief on the same morning.** 653 of its answers named no course at all.
 * 5000 units refused a 24 300-unit purchase.
 *
 * That pair is the useful residue, because the two rehearsals are comparable —
 * same slice, same day — and they line up with the counts that predicted them:
 * **92 novel titles → 3.88 queued per question, 15 → 1.38.** The novel-title
 * count is therefore a *forecast of the rehearsal*, not merely a filter before
 * it, and it can refuse a phrasing for nothing. No untried English word now
 * scores above 41 (`videos`, and vague), so the English phrasing axis is spent:
 * the next lever is the untouched *name* axis, not a tenth qualifier.
 */
export const QUALIFIERS: Record<string, string[]> = {
  ru: ['лекции', 'курс', 'видеолекции', 'семинары', 'основы', 'курс лекций'],
  en: [
    'lectures',
    'full course',
    'lecture series',
    'course',
    'introduction',
    'class',
    'semester',
    'university',
    'playlist',
  ],
};

/**
 * And the same question for a course nobody lectures at.
 *
 * «Общая химия лекции» is how a university names its recording, and it is the
 * one phrasing school material never uses: a school course is published as
 * «химия для школьников», «школьный курс химии», «уроки химии», «химия 8
 * класс». The catalogue carries seven courses at `stage: school-*` and until
 * this existed every question it had ever asked about them was worded for a
 * lecture hall.
 *
 * Measured on 2026-08-19, against «Полный курс школьной химии» — 13 lectures,
 * 350 000 views, and absent from the catalogue. `general-chemistry` had been
 * asked exactly one question ever, «Общая химия лекции», and the playlist is
 * the 21st of its 50 answers. Under the phrasings below it is 1st («Химия
 * школьный курс»), 4th, 7th and 9th.
 *
 * So the ranking is not what kept it out — the same 50 answers held it all
 * along, and `_hunt.ts` dropped it at vetting for a reason that has nothing to
 * do with search ([lib/rules.ts](rules.ts), `SCHOOL_FORMS`). What these
 * phrasings buy is the other 49 answers on each page: four school-worded
 * questions are four pages of school material that the lecture-hall wording
 * never returns at all.
 *
 * Chosen by `stage`, so a school course added next year is asked about
 * correctly without anybody remembering this file exists.
 */
export const SCHOOL_QUALIFIERS: Record<string, string[]> = {
  ru: ['для школьников', 'школьный курс', 'уроки'],
  en: ['for high school', 'lessons', 'crash course'],
};

/** `stage` as data/courses/*.yaml writes it — school-9, school-10, school-11. */
export function isSchoolStage(stage: Course['stage'] | string | undefined): boolean {
  return typeof stage === 'string' && stage.startsWith('school-');
}

/**
 * The phrasings to try for one course, in the order they are worth trying.
 *
 * School phrasings come first for a school course and the academic ones stay
 * behind them rather than being replaced: «Общая химия лекции» is a fair
 * question about a school subject too — Teach-in films exactly that — it is
 * simply not the first one worth 100 units.
 */
export function qualifiersFor(lang: string, stage: Course['stage'] | string | undefined): string[] {
  const academic = QUALIFIERS[lang] ?? [''];
  if (!isSchoolStage(stage)) return academic;
  return [...(SCHOOL_QUALIFIERS[lang] ?? []), ...academic];
}

/**
 * Which of a course's names are worth spending a question on.
 *
 * The title alone is what the hunt used to ask under, and for a school course
 * that is the wrong half of the name: `general-chemistry` is titled «Общая
 * химия», which is the university's word for it, while its material is titled
 * «Химия». The bare alias is the better question and costs the same, so a
 * school course asks under both — and only a school course, because for
 * everything else the short alias is the ambiguous one («Алгебра» for abstract
 * algebra) and the title is the precise one.
 */
export function searchNames(
  title: string | undefined,
  aliases: string[],
  stage: Course['stage'] | string | undefined
): string[] {
  const names: string[] = [];
  if (title) names.push(title);
  if (isSchoolStage(stage)) {
    // The shortest alias is the bare subject: «Химия» beside «Основы химии»,
    // «Биология» beside «Основы биологии». One extra question per language.
    const shortest = [...aliases].sort((a, b) => a.length - b.length)[0];
    if (shortest && !names.some((name) => name.toLowerCase() === shortest.toLowerCase())) {
      names.push(shortest);
    }
  }
  return names;
}

/* ───────────────────────────  The pool of questions  ─────────────────────── */

/**
 * One course, and every name it is worth asking about it under.
 *
 * The brief is written by the holes in the catalogue rather than by hand, so
 * the only thing a caller chooses is where the line between thin and not is.
 */
export type QuestionTarget = {
  courseId: string;
  playlists: number;
  /** From the built catalogue: what phrasing the material is published under. */
  stage?: string;
  names: Array<{ lang: string; name: string }>;
};

/** One paid question: 100 units of `search.list`, billed under `questionKey`. */
export type Question = {
  courseId: string;
  lang: string;
  kind: 'playlist' | 'channel';
  q: string;
};

/** The built catalogue — the brief, and the domains the channel side ranks by. */
export function builtCourses(): Array<{
  id: string;
  playlistCount: number;
  playlistsByLang?: Record<string, number>;
  stage?: string;
  domains?: string[];
}> {
  const file = path.join(paths.outData, 'courses.json');
  if (!fs.existsSync(file)) {
    throw new Error(`${file} is missing — run \`make data\` first: the brief is written by it.`);
  }
  return (
    JSON.parse(fs.readFileSync(file, 'utf8')) as {
      courses: Array<{
        id: string;
        playlistCount: number;
        playlistsByLang?: Record<string, number>;
        stage?: string;
        domains?: string[];
      }>;
    }
  ).courses;
}

/**
 * Which courses to ask about, and under what names.
 *
 * `playlistCount` comes from the built catalogue rather than from `matches`,
 * because that is the number the site actually shows: a course with nine weak
 * guesses against it is empty to a reader. The names come from the same
 * dictionaries the rule pass reads, so a course is searched for in every
 * language it has a name in — which for this catalogue is the whole point, as
 * the fields it is thinnest in are the ones English lists never cover.
 */
export function questionBrief(opts: {
  min: number;
  courses?: string[];
  /**
   * Ask in this language only, and count the holes in it only.
   *
   * `playlistCount` is the total, and a course with forty Russian recordings and
   * no English one is full by that number and empty to anybody who does not read
   * Russian. `--lang=en` makes the brief mean "thin **in English**" and stops it
   * spending half the day's questions on the language that is already covered.
   */
  lang?: string;
}): QuestionTarget[] {
  const built = builtCourses();
  const held = (course: (typeof built)[number]): number =>
    opts.lang ? (course.playlistsByLang?.[opts.lang] ?? 0) : course.playlistCount;
  const counts = new Map(built.map((course) => [course.id, held(course)]));
  const stages = new Map(built.map((course) => [course.id, course.stage]));

  const chosen = opts.courses?.length
    ? opts.courses
    : built
        .filter((course) => held(course) < opts.min)
        .sort((a, b) => held(a) - held(b))
        .map((course) => course.id);

  const languages = opts.lang ? [opts.lang] : ['ru', 'en'];
  const dictionaries = languages.map((lang) => ({
    lang,
    i18n: loadDictionary(lang),
    aliases: loadAliases(lang),
  }));

  return chosen.map((courseId) => {
    const names: Array<{ lang: string; name: string }> = [];
    const stage = stages.get(courseId);
    for (const { lang, i18n, aliases } of dictionaries) {
      for (const name of searchNames(
        i18n[`course.${courseId}.title`],
        aliases[`course.${courseId}`] ?? [],
        stage
      )) {
        names.push({ lang, name });
      }
    }
    return { courseId, playlists: counts.get(courseId) ?? 0, stage, names };
  });
}

/**
 * Every question the brief defines, in the order they are worth asking.
 *
 * Variant-major, and that is the whole reason `all` is not a loop around the
 * caller: the first phrasing of every course is worth more than the second
 * phrasing of a third of them, so a run cut short by the budget is cut where
 * the answers are already thinnest.
 */
export function questionsFor(
  targets: QuestionTarget[],
  kinds: Array<'playlist' | 'channel'>,
  variant: number | 'all'
): Question[] {
  const widest = Math.max(
    ...targets.flatMap((target) =>
      target.names.map(({ lang }) => qualifiersFor(lang, target.stage).length)
    ),
    0
  );
  const rounds = variant === 'all' ? [...Array(widest).keys()] : [variant];
  const seen = new Set<string>();
  const list: Question[] = [];
  for (const round of rounds) {
    for (const target of targets) {
      for (const { lang, name } of target.names) {
        for (const kind of kinds) {
          const phrasings = qualifiersFor(lang, target.stage);
          if (round >= phrasings.length) continue;
          const q = `${name} ${phrasings[round]}`.trim();
          const key = `${kind}:${q.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          list.push({ courseId: target.courseId, lang, kind, q });
        }
      }
    }
  }
  return list;
}

/** The id a question is billed under — see the `searches` table in lib/db.ts. */
export function questionKey(question: Question): string {
  return `${question.kind}:${question.q.toLowerCase()}`;
}

/**
 * Drops the questions some earlier run already paid a hundred units for.
 *
 * Search returns a ranked first page that barely moves from one week to the
 * next, so the second copy of an answer carries no information and costs
 * exactly what the first did. Before this, the only thing standing between a
 * hunt and re-buying its predecessor's answers was whoever ran it remembering
 * which courses the last one covered and passing a different `--variant`.
 *
 * It is also what makes the pool *countable* without spending anything, which
 * is how a day is planned: `_day.ts` asks this the same way the hunt does, so
 * the two cannot drift.
 */
export function unaskedQuestions(
  db: Db,
  list: Question[]
): { fresh: Question[]; skipped: number } {
  const asked = new Set(
    (db.prepare(`SELECT id FROM searches`).all() as Array<{ id: string }>).map((row) => row.id)
  );
  const fresh = list.filter((question) => !asked.has(questionKey(question)));
  return { fresh, skipped: list.length - fresh.length };
}
