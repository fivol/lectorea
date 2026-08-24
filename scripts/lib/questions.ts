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
 */
export const QUALIFIERS: Record<string, string[]> = {
  ru: ['лекции', 'курс', 'видеолекции', 'семинары', 'основы'],
  en: ['lectures', 'full course', 'lecture series', 'course', 'introduction'],
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
