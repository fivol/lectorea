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
/**
 * What school material puts around a subject, and a university never does.
 *
 * A course at `stage: school-*` is published under the level as much as under
 * the subject — «Полный курс школьной химии», «Химия 8 класс», «Биология для
 * школьников», «Школьный курс алгебры» — and the qualifier is most of the
 * clause, so a keyword holding only the head noun scores 0.6 and never
 * publishes. It is the faculty-title pattern of docs/agents/data-traps.md with
 * a different qualifier, and it has the same answer: **store the whole phrase.**
 *
 * Written once and combined with every name the course has, rather than typed
 * out per course, because it is the `stage` that predicts the phrasing.
 * `school-algebra` had this vocabulary by hand since the day it was added and
 * the other six school courses never got it — which is exactly the shape of
 * thing a list in one place fixes for good, including for the school course
 * added next year.
 *
 * Combinations that are not Russian — «уроки химия», «школьная химии» — are
 * generated too and cost nothing: a phrase nothing is titled is a string that
 * never matches. Paying for that is much cheaper than asking this file to know
 * which case and gender each of 225 course names is in.
 *
 * The one form that cannot be generated is the genitive of the noun itself
 * («химия» → «химии»), which Russian does not derive from the nominative
 * without a stemmer and this file refuses to guess. It is written down beside
 * the course in data/keywords/ru.json, once, and every template below then
 * reaches it.
 */
const SCHOOL_FORMS: string[] = [
  'школьная {}',
  'школьный {}',
  'школьное {}',
  'школьной {}',
  'школьного {}',
  'школьный курс {}',
  'уроки {}',
  '{} для школьников',
  '{} школьникам',
  // Cleaned, «Алгебра 7-11 классы» is «алгебра классы»: the range is stripped
  // by the course-code rule long before anything reads the word after it.
  '{} класс',
  '{} классы',
  '{} 5 класс',
  '{} 6 класс',
  '{} 7 класс',
  '{} 8 класс',
  '{} 9 класс',
  '{} 10 класс',
  '{} 11 класс',
  'high school {}',
  '{} for high school',
];

/** `stage` as data/courses/*.yaml writes it — school-9, school-10, school-11. */
function isSchoolStage(stage: string | undefined): boolean {
  return typeof stage === 'string' && stage.startsWith('school-');
}

/**
 * Words that end in `s` and are already singular, so trimming one would invent
 * a stem that is not a word — and `findPhrase` lets a phrase grow three letters
 * to its right, which is exactly enough for such a stem to reach words the
 * course has nothing to do with. «mathematics» trimmed to «mathematic» matches
 * «mathematical» and would file every mathematical-physics playlist under
 * school mathematics.
 *
 * `-ics` covers the whole Greek family the catalogue is full of — physics,
 * statistics, economics, mechanics, optics, ethics, politics, linguistics,
 * genetics, classics — and the rest are the endings a plural never has.
 */
const NOT_A_PLURAL = /(?:ics|ss|us|is|as|os|ys)$/;

/**
 * The singular of an English keyword written in the plural.
 *
 * The mirror of the tolerance in `findPhrase`: a phrase may pick up an ending
 * a title added, but nothing lets it drop one the keyword itself carries. So
 * «databases» matches «Databases» and «Database Systems» — and misses
 * «Database Modeling and Design» — while the singular form matches all three,
 * the plural among them, because one letter is well inside what the right edge
 * already tolerates. Russian is untouched: its forms are a list, written out in
 * data/keywords/ru.json, and a stemmer is what this file refuses to be.
 *
 * Only the last word is tried, since that is the only edge the tolerance
 * reaches: «systems analysis» stays as it is, and a title writing it in the
 * singular still wants a keyword of its own.
 *
 * And only inside a phrase that has other words in it. A plural noun on its own
 * is the whole of what a course is called and its singular is the ordinary
 * word: measured over the catalogue, dropping the «s» from one-word keywords
 * bound «cells» to a cello recital, «graphs» to GraphQL, «groups» to a lecture
 * series' Group 1 and «currents» to AC current, because three tolerated letters
 * are more than enough to reach a different word. With a qualifier in front —
 * «operating system», «differential equation», «legal system» — the phrase
 * still names the subject in either number.
 */
function singularOf(phrase: string): string | null {
  const at = phrase.lastIndexOf(' ');
  if (at === -1) return null;
  const last = phrase.slice(at + 1);
  if (!/^[a-z]{4,}s$/.test(last) || NOT_A_PLURAL.test(last)) return null;
  // «-es» is the plural of a word that could not take a bare «s»: box → boxes,
  // process → processes. Anywhere else the «e» belongs to the word.
  const stem = /(?:s|x|z|ch|sh)es$/.test(last) ? last.slice(0, -2) : last.slice(0, -1);
  return phrase.slice(0, at + 1) + stem;
}

export function buildKeywordIndex(sources: Sources): KeywordIndex {
  const index: KeywordIndex = [];
  for (const course of sources.courses) {
    const phrases = new Set<string>();
    // Cleaned the same way titles are, and for the same reason `normalize` is
    // shared with the client: a keyword written «theory of computation» has to
    // survive the pass that takes «of» out of every title, or it stops matching
    // anything at all.
    for (const name of sources.courseNames.get(course.id) ?? []) {
      // …but a name whose meaning was in the words the noise pass removes must
      // not survive as the word that is left. «Introduction to Language» is a
      // fair alias for linguistics and comes out of `cleanTitle` as «language»,
      // which then binds «GO Language», «C Language tutorials» and «Al Nakba -
      // Languages» at 0.95 apiece. A name that collapses to a single word says
      // nothing a one-word keyword would not say better, and the catalogue can
      // always write that word out in `keywords/{lang}.json` on purpose.
      const cleaned = cleanTitle(name);
      if (!cleaned.includes(' ') && name.trim().split(/\s+/).length >= 3) continue;
      phrases.add(cleaned);
    }
    // The level is part of the name for a course read at school — see
    // `SCHOOL_FORMS`. Generated from what the course is already called, so the
    // whole class is covered by the `stage` rather than by whoever remembers.
    if (isSchoolStage(course.stage)) {
      for (const base of [...phrases]) {
        for (const form of SCHOOL_FORMS) {
          const cleaned = cleanTitle(form.replace('{}', base));
          if (cleaned) phrases.add(cleaned);
        }
      }
    }
    // Written after the school forms so a generated «{} classes» is de-pluralised
    // too, and into the same set, so a course that already lists both forms by
    // hand gets one entry rather than two.
    for (const base of [...phrases]) {
      const singular = singularOf(base);
      if (singular) phrases.add(singular);
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
  // A label is a label by where it sits and by how the title wrote it — two
  // conditions, both learned from what dropping it on the word alone costs.
  //
  // *Written*: «Introduction to Computer Science» comes out of the noise pass
  // as «computer science» and is indistinguishable from the label by then, so
  // the question is put to the title as written — the same two-texts split
  // `rawSegments` exists for.
  //
  // *Leading*: a mirror files in front of the title and never behind it, so
  // «Computer Science - Riemann Hypothesis» is a filing prefix while «Princeton
  // COS 126: Computer Science — An Interdisciplinary Approach» and «Crash
  // Course: Computer Science» are courses that happen to say their subject.
  // Only the first clause is a category; a bare «Physics» is its own first
  // clause, which is what still refuses a topic bin.
  const written = rawSegments(raw);
  const filed = DEPARTMENT.has(written[0] ?? '') ? written[0] : null;
  return text
    .split(SEGMENT)
    .map((segment) => normalize(segment ?? ''))
    .filter(Boolean)
    .filter((segment) => segment !== filed);
}

/**
 * The clauses as they were written, with only the punctuation read — the same
 * split, none of the noise stripped.
 *
 * The refusal list needs this, and only the refusal list. `NOISE` exists so
 * that coverage measures a subject against a subject, and it takes out
 * `playlist`, `videos`, `full`, `course` — the very words by which a title
 * announces that it is not a course. «Dance & Electronic Music Playlist |
 * Genre» arrived at the matcher as «dance electronic music» and «genre», the
 * second of which is an exact keyword of literary theory, and 1241 tracks of
 * house music became a course on it at confidence 0.95.
 *
 * So the two questions are asked of two texts: *is this a course at all* of the
 * title as written, and *which course* of the title with the noise gone.
 */
export function rawSegments(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(SEGMENT)
    .map((segment) => normalize(segment ?? ''))
    .filter(Boolean);
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
  // Spelt out as well as abbreviated. Without it the label covers its own
  // clause at 0.95 and answers for the whole title, which filed «Computer
  // Science - Riemann Hypothesis and its Applications» under programming-intro
  // — nine published bindings, each of them a different subject.
  'computer science',
  'computer science and engineering',
  'chemical',
  // NPTEL's own bucket above a department, and never a subject: «Core -
  // Probability and Statistics», «Core - Leadership», «Core - Quantum Physics».
  'core',
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

  // A chapter of a course, published as its own playlist. «CPU Scheduling |
  // Chapter 5 | Operating System» names its course in a clause of its own, so
  // it binds as confidently as the course itself — and the catalogue then shows
  // sixteen entries that are each a sixteenth of one semester. The unit here is
  // the semester; docs/channel-hunt.md refused a whole channel for this shape
  // and the rule is the same judgement made cheaply. 171 playlists on
  // 2026-08-14, every one of them a fragment.
  //
  // A bare number is what separates this from «Матанализ. Часть 2», which is a
  // real half of a real course and keeps its number through the NOISE pass
  // above: «часть» is deliberately absent here, and matched 0 of the 230 titles
  // that use it.
  /^(?:chapter|глава)\s*\d+$/u,

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

  // A playlist that calls itself a playlist of music. Read on the title as
  // written — `NOISE` takes `playlist` out, and without it «Ambient Music
  // Playlist | Genre» is «ambient music» plus a keyword of literary theory.
  /(?<![\p{L}\p{N}])(?:music|songs?|hits|mix|beats|karaoke|музыка|песни)\s+playlist(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])playlist\s+(?:mix|music|songs?|hits)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:full album|альбом целиком|lo-?fi|instrumental beats)(?![\p{L}\p{N}])/u,

  // Exam tracks, in the languages that were missing. ЕГЭ, ОГЭ and олимпиады
  // are refused above and these are the same thing under another flag: AP and
  // GCSE are school syllabuses sat as an exam, and MCAT, NEET and JEE are
  // entrance tests. They also arrive in the one shape this catalogue cannot
  // store — «Supply, demand, and market equilibrium | AP Microeconomics» is a
  // topic of a course, published as a playlist, one of forty. 142 Khan Academy
  // playlists were bound as whole courses on 2026-08-15, most of them a
  // fortieth of one.
  /(?<![\p{L}\p{N}])ap\s+\p{L}{4,}(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:gcse|igcse|a-?levels?|mcat|neet|sat prep|act prep)(?![\p{L}\p{N}])/u,

  // The same exam shape once more, under the flags a *professional body* flies
  // rather than a school: the civil-service and accountancy coaching industry.
  // It was invisible while every playlist came from a vetted teaching channel
  // and is unmissable the moment anything asks YouTube a question — «Anthropology
  // for UPSC», «CA Inter Strategic Management», «Strategic Management - CS
  // Professional - New Syllabus» were 49 of the 63 answers to one query on
  // 2026-08-15, and each is a syllabus read out against an exam paper rather
  // than a course taught in order.
  //
  // Written as whole brands and never as bare initials, because the initials
  // are words elsewhere: `CSE` is computer science and engineering, `GATE` is a
  // gate, `CPA` and `CMA` are costs per action and per mille in half the
  // marketing playlists on the service. `upsc`, `ncert` and `ugc net` have no
  // second meaning; `ca`/`cs` are only read next to the paper they name.
  /(?<![\p{L}\p{N}])(?:upsc|ncert|ugc\s*net|css\s+exam)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:ca|cma)\s+(?:inter|final|foundation)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])cs\s+(?:executive|professional)(?![\p{L}\p{N}])/u,
  /(?<![\p{L}\p{N}])(?:cima|acca|cfa\s+level)(?![\p{L}\p{N}])/u,
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

/**
 * The best a single clause of a title can say, and whether it named anything.
 *
 * `named` is true whenever a course keyword occurred, including when the clause
 * is then declined for naming two courses at once. The caller needs that apart
 * from the verdict: a declined clause is a question, an empty one is not.
 */
function matchSegment(
  segment: string,
  index: KeywordIndex
): { candidate: RuleCandidate | null; named: boolean } {
  const hits: Array<{ courseId: string; phrase: string; at: number }> = [];
  for (const entry of index) {
    const at = findPhrase(segment, entry.phrase);
    if (at !== -1) hits.push({ courseId: entry.courseId, phrase: entry.phrase, at });
  }
  if (!hits.length) return { candidate: null, named: false };

  // The index is sorted longest-first, so the first hit is the most specific:
  // «quantum mechanics» beats «mechanics» on a title that contains both.
  const best = hits[0];

  // Two courses with equally specific claims is exactly the ambiguity a human
  // should look at, so it is handed over rather than guessed.
  const equallySpecific = new Set(
    hits.filter((hit) => hit.phrase.length === best.phrase.length).map((hit) => hit.courseId)
  );
  if (equallySpecific.size > 1) return { candidate: null, named: true };
  if (hasRivalTopic(best, hits)) return { candidate: null, named: true };

  return {
    candidate: { courseId: best.courseId, confidence: confidenceFor(segment, best.phrase, best.at) },
    named: true,
  };
}

/**
 * What the rules concluded — and the four different things "no" can mean, each
 * of which wants something different done about it.
 *
 * | verdict | means | what it is worth |
 * |---|---|---|
 * | `match` | one course, this confident | bind it |
 * | `not-a-course` | the title says homework, music video, open day | a decision: record it |
 * | `unclaimed` | no course of this catalogue is named in the title at all | a keyword may be missing — or there is simply no such course here |
 * | `undecided` | a course is named, but weakly or ambiguously | the review queue proper: what a person is for |
 * | `no-title` | the metadata pass has not reached it | nothing to judge yet |
 *
 * `matchByRules` collapses all four into `null`, which is all a caller binding
 * a playlist needs. `05-match.ts` needs them apart: it can record a decision
 * and stop paying for it every run, and it must not record an absence.
 */
export type RuleVerdict =
  | ({ kind: 'match' } & RuleCandidate)
  | { kind: 'not-a-course' }
  | { kind: 'unclaimed' }
  | { kind: 'undecided' }
  | { kind: 'no-title' };

export function judgeByRules(playlist: PlaylistRow, index: KeywordIndex): RuleVerdict {
  // A seam queues a playlist before the metadata pass has reached it, so the
  // title can still be missing — and a pass that binds by the title alone has
  // nothing to say about a playlist that has none. The same null that stopped
  // `videoQueueTiers` on 2026-08-12, one step further down the pipeline.
  if (!playlist.title) return { kind: 'no-title' };
  const segments = cleanSegments(playlist.title);
  if (!segments.length) return { kind: 'unclaimed' };
  // Support material is refused on the whole title: «homework» can sit in a
  // clause of its own, and the clause naming the subject would not see it.
  // Asked of both readings of the title — see `rawSegments` for the house
  // music that reached the catalogue through the gap between them.
  if (segments.some(isNotACourse) || rawSegments(playlist.title).some(isNotACourse)) {
    return { kind: 'not-a-course' };
  }

  const { best, named } = bestSegmentMatch(segments, index);
  if (best) return { kind: 'match', ...best };
  return named ? { kind: 'undecided' } : { kind: 'unclaimed' };
}

export function matchByRules(playlist: PlaylistRow, index: KeywordIndex): RuleCandidate | null {
  const verdict = judgeByRules(playlist, index);
  return verdict.kind === 'match'
    ? { courseId: verdict.courseId, confidence: verdict.confidence }
    : null;
}

/**
 * The best any clause of a title can say, once support material is out — and
 * whether any course was named at all.
 *
 * The second answer is not the first one's absence. «Graph Theory and Additive
 * Combinatorics» names two courses and settles neither; «Juice WRLD Freestyles»
 * names none. Both come back without a binding and they are not the same
 * problem: one is a question for a person, the other is a playlist this
 * catalogue has no course for.
 */
function bestSegmentMatch(
  segments: string[],
  index: KeywordIndex
): { best: RuleCandidate | null; named: boolean } {
  let best: RuleCandidate | null = null;
  let runnerUp: RuleCandidate | null = null;
  let named = false;
  for (const segment of segments) {
    const { candidate, named: hit } = matchSegment(segment, index);
    named ||= hit;
    if (!candidate) continue;
    if (!best || candidate.confidence > best.confidence) {
      if (best && best.courseId !== candidate.courseId) runnerUp = best;
      best = candidate;
    } else if (candidate.courseId !== best.courseId) {
      if (!runnerUp || candidate.confidence > runnerUp.confidence) runnerUp = candidate;
    }
  }
  if (!best) return { best: null, named };

  // Two clauses naming two different subjects, each convincingly — «Линейная
  // алгебра | Дифференциальные уравнения» — is the same ambiguity as two
  // courses claiming one clause, and gets the same answer: a human.
  if (runnerUp && runnerUp.confidence >= best.confidence - 0.05) return { best: null, named };

  return { best, named };
}
