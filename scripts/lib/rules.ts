import { normalize } from '../../shared/search.js';
import type { PlaylistRow } from './db.js';
import type { Sources } from './sources.js';

/**
 * Binding a playlist to a course by its title alone.
 *
 * The rule pass is the cheap half of `05-match.ts`: no network, no model, just
 * the synonym dictionary in data/keywords/{lang}.json. It is allowed to be
 * wrong in one direction only — a playlist it refuses goes to a human, which
 * costs attention, while a playlist it binds wrongly goes into the catalogue
 * and lies there. So everything here is biased towards refusing.
 *
 * Three things decide the answer:
 *
 *   1. the phrase has to sit on word boundaries, not anywhere inside a word,
 *      or `logic` matches «biological» and `mechanics` matches «biomechanics»;
 *   2. how much of the title the phrase covers, because «Linear Algebra» being
 *      the whole title means something and being three words out of twelve does
 *      not;
 *   3. whether another course claims a different part of the same title, which
 *      is the signature of a title about two subjects at once.
 */

export type RuleCandidate = { courseId: string; confidence: number };
export type KeywordIndex = Array<{ courseId: string; phrase: string }>;

/** Under four characters a keyword matches half the catalogue; only search wants those. */
const MIN_PHRASE = 4;

/**
 * Longest phrases first: «теория вероятностей» must win over «вероятность»,
 * otherwise every probability course collapses into the same match.
 */
export function buildKeywordIndex(sources: Sources): KeywordIndex {
  const index: KeywordIndex = [];
  for (const course of sources.courses) {
    const phrases = new Set<string>();
    const title = sources.i18n[`course.${course.id}.title`];
    if (title) phrases.add(normalize(title));
    for (const keyword of sources.keywords[`course.${course.id}`] ?? []) {
      phrases.add(normalize(keyword));
    }
    for (const phrase of phrases) {
      if (phrase.length >= MIN_PHRASE) index.push({ courseId: course.id, phrase });
    }
  }
  return index.sort((a, b) => b.phrase.length - a.phrase.length);
}

/* ─────────────────────────────  Title cleaning  ─────────────────────────── */

/**
 * Course codes, terms and years say nothing about the subject but make up most
 * of an OCW title, and coverage is measured against what is left. Without this
 * «MIT 18.06SC Linear Algebra, Fall 2011» buries its own subject under noise.
 */
const NOISE: RegExp[] = [
  /(?<![\p{L}\p{N}])\d{1,3}[.\-]\d{1,3}[a-z]*(?![\p{L}\p{N}])/gu, // 18.06sc, 6.042j
  /(?<![\p{L}\p{N}])[a-z]{2,4}\.[a-z]?\d[\d.\-]*[a-z]*(?![\p{L}\p{N}])/gu, // res.6-008, mas.s62
  /(?<![\p{L}\p{N}])[a-z]{2,5}\d{3,5}[a-z]*(?![\p{L}\p{N}])/gu, // elec3104, comp1400, cs229
  /(?<![\p{L}\p{N}])(?:fall|spring|summer|winter|autumn)(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])(?:осень|весна|осенний|весенний|семестр|поток|курс)(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])(?:19|20)\d{2}(?:[\/-](?:19|20)?\d{2})?(?![\p{L}\p{N}])/gu, // 2011, 2020/21
  /(?<![\p{L}\p{N}])(?:lecture|lectures|видеолекции|лекции|лекция)(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])(?:part|часть|section|полный)(?![\p{L}\p{N}])/gu,
];

/**
 * Noise is stripped *before* normalisation, while the punctuation that marks it
 * is still there. Normalising first turns «18.02» into «18 02», and a course
 * code that has lost its dot is indistinguishable from the «2» in «Матанализ 2»
 * — which has to survive, since it is what separates two different courses.
 */
export function cleanTitle(raw: string): string {
  let text = raw.toLowerCase().replace(/ё/g, 'е');
  for (const pattern of NOISE) text = text.replace(pattern, ' ');
  return normalize(text);
}

/* ──────────────────────────  Not-a-course filter  ───────────────────────── */

/**
 * Material that belongs *around* a course rather than being one. Seminars and
 * problem classes are deliberately absent: they are a legitimate `kind` of
 * playlist and the interface filters on it. What is listed here either
 * supplements a course that has its own playlist (homework walkthroughs, exam
 * prep) or is not teaching at all (podcasts, open days, promos).
 */
const NOT_A_COURSE: RegExp[] = [
  /(?<![\p{L}\p{N}])(?:homework|problem set|exam prep|midterm|final review|office hours)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:recitation|walkthrough|q&a|ама|подкаст|podcast)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:trailer|teaser|promo|тизер|трейлер|промо|анонс|реклама)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:shorts|шортс|нарезки|клипы)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:олимпиад\p{L}*|вступительн\p{L}*|абитуриент\p{L}*|егэ|огэ)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:день открытых дверей|дни открытых дверей|приемная кампания)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:интервью|конференци\p{L}*|коллоквиум|colloquium|seminar series)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:recent videos|popular videos|все видео|новые видео|остальное)(?![\p{L}\p{N}])/u,
];

export function isNotACourse(cleaned: string): boolean {
  return NOT_A_COURSE.some((pattern) => pattern.test(cleaned));
}

/* ───────────────────────────  Boundary matching  ────────────────────────── */

const WORD = /[\p{L}\p{N}]/u;

/** Russian inflection is a list of forms, not a stemmer — but a short tail is free. */
const MAX_INFLECTION = 3;

/**
 * Where `phrase` occurs in `title` as a word, or -1.
 *
 * The left edge must be a real boundary. The right edge tolerates a few letters
 * so «алгебра» still matches «алгебры», while «алгебраические» — eight letters
 * past the phrase — does not.
 */
export function findPhrase(title: string, phrase: string): number {
  let at = title.indexOf(phrase);
  while (at !== -1) {
    const before = at === 0 ? '' : title[at - 1];
    if (!before || !WORD.test(before)) {
      let end = at + phrase.length;
      let tail = 0;
      while (end < title.length && WORD.test(title[end]) && tail <= MAX_INFLECTION) {
        end += 1;
        tail += 1;
      }
      if (tail <= MAX_INFLECTION) return at;
    }
    at = title.indexOf(phrase, at + 1);
  }
  return -1;
}

/* ────────────────────────────────  Scoring  ─────────────────────────────── */

/**
 * Confidence from how much of the title the phrase accounts for.
 *
 * The thresholds are set against the 0.75 the catalogue requires: a title that
 * is mostly the subject is taken automatically, a title where the subject is a
 * passing mention is not. «Introduction to Ancient Greek History with Donald
 * Kagan» mentioning `ancient greek` is the case this is here to refuse.
 */
function confidenceFor(title: string, phrase: string, at: number): number {
  if (title === phrase) return 0.95;
  const coverage = phrase.length / title.length;
  const leads = at === 0;
  if (coverage >= 0.7) return 0.92;
  if (coverage >= 0.45) return leads ? 0.88 : 0.82;
  if (coverage >= 0.25) return leads ? 0.78 : 0.68;
  return 0.6;
}

/**
 * A second course claiming a different span of the same title means the title
 * is about two things — «Linear Algebra and Differential Equations» — and which
 * one the playlist teaches is not something a substring can settle.
 */
function hasRivalTopic(
  best: { courseId: string; phrase: string; at: number },
  hits: Array<{ courseId: string; phrase: string; at: number }>
): boolean {
  const bestEnd = best.at + best.phrase.length;
  return hits.some((hit) => {
    if (hit.courseId === best.courseId) return false;
    const end = hit.at + hit.phrase.length;
    if (hit.at < bestEnd && best.at < end) return false; // overlapping, same span
    // Adjacent words are one noun phrase, not two subjects: in «multivariable
    // calculus» the keywords belong to different courses but describe one
    // thing. A real rival is separated by something — «Psychology and
    // Economics», «Graph Theory and Additive Combinatorics».
    const gap = Math.max(best.at, hit.at) - Math.min(bestEnd, end);
    if (gap <= 1) return false;
    // A stray short word is not a rival; something comparable in weight is.
    return hit.phrase.length >= best.phrase.length * 0.6;
  });
}

export function matchByRules(playlist: PlaylistRow, index: KeywordIndex): RuleCandidate | null {
  const title = cleanTitle(playlist.title);
  if (!title || isNotACourse(title)) return null;

  const hits: Array<{ courseId: string; phrase: string; at: number }> = [];
  for (const entry of index) {
    const at = findPhrase(title, entry.phrase);
    if (at !== -1) hits.push({ courseId: entry.courseId, phrase: entry.phrase, at });
  }
  if (!hits.length) return null;

  // The index is sorted longest-first, so the first hit is the most specific:
  // «quantum mechanics» beats «mechanics» on a title that contains both.
  const best = hits[0];

  // Two courses with equally specific claims is exactly the ambiguity a human
  // should look at, so it is handed over rather than guessed.
  const equallySpecific = new Set(
    hits.filter((hit) => hit.phrase.length === best.phrase.length).map((hit) => hit.courseId)
  );
  if (equallySpecific.size > 1) return null;
  if (hasRivalTopic(best, hits)) return null;

  return { courseId: best.courseId, confidence: confidenceFor(title, best.phrase, best.at) };
}
