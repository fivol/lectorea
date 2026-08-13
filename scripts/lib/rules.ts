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
 * Four things decide the answer:
 *
 *   1. the phrase has to sit on word boundaries, not anywhere inside a word,
 *      or `logic` matches «biological» and `mechanics` matches «biomechanics»;
 *   2. a title is read in segments — «Функциональный анализ | Фёдор Петров»
 *      names a subject and then a lecturer — so that coverage means how much of
 *      the *subject* the phrase accounts for;
 *   3. how much of its segment the phrase covers, because a word glued to the
 *      front of a keyword usually renames it: «линейное программирование» is
 *      not programming and «tensor calculus» is not calculus;
 *   4. whether another course claims a different part of the same title, which
 *      is the signature of a title about two subjects at once.
 */

export type RuleCandidate = { courseId: string; confidence: number };
export type KeywordIndex = Array<{ courseId: string; phrase: string }>;

/** Under four characters a keyword matches half the catalogue; only search wants those. */
const MIN_PHRASE = 4;

/**
 * Longest phrases first: «теория вероятностей» must win over «вероятность»,
 * otherwise every probability course collapses into the same match.
 *
 * Every language at once, from `sources.courseNames` — a playlist is titled in
 * the language its author speaks, not the one the build renders in.
 */
export function buildKeywordIndex(sources: Sources): KeywordIndex {
  const index: KeywordIndex = [];
  for (const course of sources.courses) {
    const phrases = new Set<string>();
    // Cleaned the same way titles are, and for the same reason `normalize` is
    // shared with the client: a keyword written «theory of computation» has to
    // survive the pass that takes «of» out of every title, or it stops matching
    // anything at all.
    for (const name of sources.courseNames.get(course.id) ?? []) {
      phrases.add(cleanTitle(name));
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
  // The year of study goes with its number, unlike «часть» below. «2 курс» is
  // when a student takes the course, not which course it is — left as a bare
  // «2» it reads as the ordinal that separates «Матанализ 1» from «Матанализ 2»
  // and files the whole second year of analysis under the wrong semester.
  /(?<![\p{L}\p{N}])\d{1,2}\s*(?:курс|семестр|поток)(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])(?:курс|семестр|поток)\s*\d{1,2}(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])(?:fall|spring|summer|winter|autumn)(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])(?:осень|весна|осенний|весенний|семестр|поток|курс)(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])(?:19|20)\d{2}(?:[\/-](?:19|20)?\d{2})?(?![\p{L}\p{N}])/gu, // 2011, 2020/21
  /(?<![\p{L}\p{N}])(?:lecture|lectures|видеолекции|лекции|лекция)(?![\p{L}\p{N}])/gu,
  // «часть» goes and its number stays: «Матанализ. Часть 2» *is* «Матанализ 2».
  /(?<![\p{L}\p{N}])(?:part|часть|section|полный)(?![\p{L}\p{N}])/gu,
  // Who is teaching it. Coverage asks what share of a clause is the subject,
  // and «MIT 18.02 Multivariable Calculus» is a fifth university by weight.
  /(?<![\p{L}\p{N}])(?:mit|stanford|yale|harvard|berkeley|caltech|oxford|cambridge|princeton|nptel|iit|iisc|unsw|coursera|edx)(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])(?:мгу|мфти|вшэ|итмо|спбгу|мифи|мисис|university|универcитет|университет)(?![\p{L}\p{N}])/gu,
  // Structural words every syllabus uses and no subject is told apart by.
  /(?<![\p{L}\p{N}])(?:introduction|introductory|intro|введение|вводный|вводная)(?![\p{L}\p{N}])/gu,
  /(?<![\p{L}\p{N}])(?:the|a|an|to|of|course|student|full|length|videos|playlist)(?![\p{L}\p{N}])/gu,
];

/**
 * What separates one clause of a title from the next.
 *
 * A full stop is only a separator when a word follows it. «Матанализ. Часть 2»
 * is one clause carrying an ordinal; «Алгебра. Городенцев А. Л.» is a subject
 * and then a lecturer.
 *
 * `with` and `by` are separators for the same reason a comma is: what follows
 * them is who taught it. «Game Theory with Ben Polak» is a game theory course
 * whose subject covers two fifths of its own title.
 */
const SEGMENT = /[|,;:()[\]{}«»"“”/\\\t]|\s[-–—]+\s|\s(?:with|by)\s|[.．](?=\s*\p{L})/u;

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

/**
 * The title as the clauses it is made of, noise gone, each normalised.
 *
 * Splitting matters because coverage is the whole measure of confidence, and
 * an undivided title makes it answer the wrong question. «Дискретная
 * математика | Роман Глинских | осень 2021» is two thirds punctuation and
 * names, so the subject covers a third of it and scores like a passing
 * mention — while «линейное программирование», which really is a passing
 * resemblance, covers half and scores like a subject. Read one clause at a
 * time, both come out right.
 */
export function cleanSegments(raw: string): string[] {
  let text = raw.toLowerCase().replace(/ё/g, 'е');
  for (const pattern of NOISE) text = text.replace(pattern, ' ');
  return text
    .split(SEGMENT)
    .map((segment) => normalize(segment ?? ''))
    .filter(Boolean)
    .filter((segment) => !DEPARTMENT.has(segment));
}

/**
 * A faculty, not a subject.
 *
 * NPTEL and the archives that mirror it file every playlist under the
 * department that recorded it — «Electronics - Linux Programming & Scripting»,
 * «Ocean - Port and Harbour Structures» — so the label arrives as a clause of
 * its own, exactly like the lecturer a comma introduces. Read as a subject it
 * beats the real one: it covers its whole clause, so it scores like a title,
 * while the course's actual name sits in the next clause where it may match
 * nothing at all. Sixty-six playlists bound to `electrical-circuits` and
 * `oceanography` this way, among them Linux scripting and harbour construction.
 *
 * Dropped rather than down-weighted, because a title that is *nothing but* a
 * department label — «Physics», «Electronics» — is a topic bin, and the bar in
 * docs/harvest.md refuses those on their own account.
 */
const DEPARTMENT = new Set([
  'electronics',
  'electrical',
  'ocean',
  'mechanical',
  'civil',
  'aerospace',
  'metallurgy',
  'mining',
  'textile',
  'agriculture',
  'biotechnology',
  'management',
  'humanities',
  'physics',
  'chemistry',
  'chemistry and bio-chemistry',
  'mathematics',
  'computer',
  'computer sc',
  'computer science and engineering',
  'atmospheric science',
  'engineering design',
]);

/* ──────────────────────────  Not-a-course filter  ───────────────────────── */

/**
 * Material that belongs *around* a course rather than being one. Seminars and
 * problem classes are deliberately absent: they are a legitimate `kind` of
 * playlist and the interface filters on it. What is listed here either
 * supplements a course that has its own playlist (homework walkthroughs, exam
 * prep) or is not teaching at all (podcasts, open days, promos).
 */
const NOT_A_COURSE: RegExp[] = [
  /(?<![\p{L}\p{N}])(?:homework|problem set|exam prep|midterm|office hours)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:final|exam|test|chapter|course)\s+review(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:recitation|walkthrough|q&a|ама|подкаст|podcast)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:trailer|teaser|promo|тизер|трейлер|промо|анонс|реклама)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:shorts|шортс|нарезки|клипы)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:олимпиад\p{L}*|вступительн\p{L}*|абитуриент\p{L}*|егэ|огэ)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:день открытых дверей|дни открытых дверей|приемная кампания)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:интервью|interviews?|конференци\p{L}*|коллоквиум|colloquium|seminar series)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:recent videos|popular videos|все видео|новые видео|остальное)(?![\p{L}\p{N}])/u,

  // Entertainment. Until the wide seams of docs/harvest.md existed, every
  // playlist came from a channel somebody had vetted, and this list had no need
  // of the category. A description saying «music I play before the lecture» and
  // a GitHub reading list with one stray link both bring it in, and the damage
  // is not a wrong binding but a wrong *crawl*: the tier queue defends the
  // quota by putting unclaimed playlists last, which protects nothing on a day
  // when everything is unclaimed. Refusing here puts them in tier 4 instead,
  // behind every real course.
  /(?<![\p{L}\p{N}])(?:official (?:music )?video|official audio|lyric video|music videos?|клип)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:nursery rhymes?|kids songs?|детские песенки|мультик\p{L}*|cartoons? for (?:kids|children))(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:full episodes?|season \d+|greatest hits|soundtracks?|top \d+ songs)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:gameplay|let's play|unboxing|reaction video|prank|memes?)(?![\p{L}\p{N}])/u,
];

export function isNotACourse(cleaned: string): boolean {
  return NOT_A_COURSE.some((pattern) => pattern.test(cleaned));
}

/* ───────────────────────────  Boundary matching  ────────────────────────── */

const WORD = /[\p{L}\p{N}]/u;

/** Russian inflection is a list of forms, not a stemmer — but a short tail is free. */
const MAX_INFLECTION = 3;

/**
 * What a phrase may pick up on its right edge. Letters only: an ending is
 * inflection, a digit is a different course. «алгебры» is «алгебра», but
 * «algebra 16» is not «algebra 1» and «calculus 23» is not «calculus 2».
 */
const INFLECTION = /\p{L}/u;

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
      while (end < title.length && INFLECTION.test(title[end]) && tail <= MAX_INFLECTION) {
        end += 1;
        tail += 1;
      }
      // A digit right after the phrase is never an ending, so the phrase has
      // simply run into the next token and this is not a word match.
      if (tail <= MAX_INFLECTION && !(end < title.length && WORD.test(title[end]))) return at;
    }
    at = title.indexOf(phrase, at + 1);
  }
  return -1;
}

/* ────────────────────────────────  Scoring  ─────────────────────────────── */

/**
 * Confidence from how much of its segment the phrase accounts for.
 *
 * The thresholds are set against the 0.75 the catalogue requires: a clause that
 * is mostly the subject is taken automatically, a clause where the subject is a
 * passing mention is not. «Introduction to Ancient Greek History with Donald
 * Kagan» mentioning `ancient greek` is the case this is here to refuse.
 *
 * Now that names and years are split off into their own segments, a real
 * subject clause is nearly all subject, and the bar sits accordingly high: what
 * is left over next to the keyword is a word that renames it. «Линейное
 * программирование» is not programming, «pre-algebra» is not algebra, «tensor
 * calculus» is not calculus — all three used to clear the bar because the
 * keyword covered half a title padded out with a lecturer.
 */
function confidenceFor(segment: string, phrase: string, at: number): number {
  if (segment === phrase) return 0.95;
  const coverage = phrase.length / segment.length;
  const leads = at === 0;
  if (coverage >= 0.85) return 0.92;
  if (coverage >= 0.7) return leads ? 0.88 : 0.82;
  if (coverage >= 0.45) return leads ? 0.72 : 0.68;
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

/** The best a single clause of a title can say, or nothing. */
function matchSegment(segment: string, index: KeywordIndex): RuleCandidate | null {
  const hits: Array<{ courseId: string; phrase: string; at: number }> = [];
  for (const entry of index) {
    const at = findPhrase(segment, entry.phrase);
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

  return { courseId: best.courseId, confidence: confidenceFor(segment, best.phrase, best.at) };
}

export function matchByRules(playlist: PlaylistRow, index: KeywordIndex): RuleCandidate | null {
  // A seam queues a playlist before the metadata pass has reached it, so the
  // title can still be missing — and a pass that binds by the title alone has
  // nothing to say about a playlist that has none. The same null that stopped
  // `videoQueueTiers` on 2026-08-12, one step further down the pipeline.
  if (!playlist.title) return null;
  const segments = cleanSegments(playlist.title);
  if (!segments.length) return null;
  // Support material is refused on the whole title: «homework» can sit in a
  // clause of its own, and the clause naming the subject would not see it.
  if (segments.some(isNotACourse)) return null;

  let best: RuleCandidate | null = null;
  let runnerUp: RuleCandidate | null = null;
  for (const segment of segments) {
    const candidate = matchSegment(segment, index);
    if (!candidate) continue;
    if (!best || candidate.confidence > best.confidence) {
      if (best && best.courseId !== candidate.courseId) runnerUp = best;
      best = candidate;
    } else if (candidate.courseId !== best.courseId) {
      if (!runnerUp || candidate.confidence > runnerUp.confidence) runnerUp = candidate;
    }
  }
  if (!best) return null;

  // Two clauses naming two different subjects, each convincingly — «Линейная
  // алгебра | Дифференциальные уравнения» — is the same ambiguity as two
  // courses claiming one clause, and gets the same answer: a human.
  if (runnerUp && runnerUp.confidence >= best.confidence - 0.05) return null;

  return best;
}
