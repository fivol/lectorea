import type { SearchEntry } from './schema.js';

/**
 * Query normalisation, shared by the build (which normalises keywords) and the
 * client (which normalises what is typed). Both sides must agree exactly,
 * otherwise a keyword written by hand silently stops matching.
 *
 * There is no morphological engine here on purpose: a stemmer for Russian
 * weighs more than the whole index and eventually decides that «мышление» and
 * «мышь» share a root. Morphology is solved on the data side — forms are listed
 * explicitly in data/keywords/{lang}.json.
 */

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ───────────────────────────  Keyboard layout  ─────────────────────────── */

const EN_TO_RU: Record<string, string> = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ', p: 'з',
  '[': 'х', ']': 'ъ', a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о',
  k: 'л', l: 'д', ';': 'ж', "'": 'э', z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и',
  n: 'т', m: 'ь', ',': 'б', '.': 'ю', '/': '.',
};

const RU_TO_EN: Record<string, string> = Object.fromEntries(
  Object.entries(EN_TO_RU).map(([en, ru]) => [ru, en])
);

/** `vfntvfnbrf` → `математика`. Only worth trying when the raw query found nothing. */
export function swapLayout(input: string): string {
  const chars = [...input.toLowerCase()];
  const looksLatin = chars.some((c) => c >= 'a' && c <= 'z');
  const table = looksLatin ? EN_TO_RU : RU_TO_EN;
  return chars.map((c) => table[c] ?? c).join('');
}

/* ─────────────────────────────  Transliteration  ───────────────────────── */

// Longest-first, so `shch` wins over `sh` and `zh` over `z`.
const TRANSLIT: Array<[string, string]> = [
  ['shch', 'щ'], ['sch', 'щ'], ['yo', 'е'], ['zh', 'ж'], ['kh', 'х'],
  ['ts', 'ц'], ['ch', 'ч'], ['sh', 'ш'], ['yu', 'ю'], ['ya', 'я'],
  ['iy', 'ий'], ['ye', 'е'], ['a', 'а'], ['b', 'б'], ['v', 'в'], ['g', 'г'],
  ['d', 'д'], ['e', 'е'], ['z', 'з'], ['i', 'и'], ['j', 'й'], ['k', 'к'],
  ['l', 'л'], ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'],
  ['s', 'с'], ['t', 'т'], ['u', 'у'], ['f', 'ф'], ['h', 'х'], ['c', 'ц'],
  ['y', 'ы'], ['q', 'к'], ['w', 'в'], ['x', 'кс'],
];

/** `matematika` → `математика`. Lossy by nature, good enough for prefix matching. */
export function translit(input: string): string {
  const source = input.toLowerCase();
  let out = '';
  let i = 0;
  outer: while (i < source.length) {
    for (const [latin, cyrillic] of TRANSLIT) {
      if (source.startsWith(latin, i)) {
        out += cyrillic;
        i += latin.length;
        continue outer;
      }
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/**
 * The variants a query is tried as, in order of trust. The caller stops at the
 * first variant that produces results, so a real word is never overridden by
 * its layout-swapped nonsense twin.
 */
export function queryVariants(raw: string): string[] {
  const base = normalize(raw);
  if (!base) return [];
  const variants = [base];
  const swapped = normalize(swapLayout(base));
  if (swapped && swapped !== base) variants.push(swapped);
  const transliterated = normalize(translit(base));
  if (transliterated && !variants.includes(transliterated)) variants.push(transliterated);
  return variants;
}

/**
 * Normalises while remembering where every character came from.
 *
 * `normalize` collapses runs of whitespace and trims, so an index into its
 * output does not point at the same character in the input. Highlighting needs
 * that mapping — otherwise the marked span drifts by however many separators
 * came before it.
 */
function normalizeWithMap(input: string): { text: string; source: number[] } {
  const out: string[] = [];
  const source: number[] = [];
  let pendingSpace = false;

  for (let i = 0; i < input.length; i++) {
    const raw = input[i].toLowerCase().replace(/ё/g, 'е');
    const isSeparator = !/[\p{L}\p{N}+-]/u.test(raw);
    if (isSeparator) {
      // Leading separators produce nothing; interior ones collapse to one space.
      if (out.length) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      out.push(' ');
      source.push(i);
      pendingSpace = false;
    }
    out.push(raw);
    source.push(i);
  }

  return { text: out.join(''), source };
}

/**
 * Where a query matches inside a name, as ranges over the original string.
 *
 * A fuzzy-looking hit with nothing marked reads as a bug: «ав» finding
 * «Савватеев» has to be able to show why. The query is tried in the same order
 * of trust as the search itself, so a transliterated or layout-swapped hit
 * highlights the characters it actually matched.
 *
 * When the phrase is not there as a phrase, the words are marked one by one —
 * because that is also how the row was found (see `tokenScore`). «савватеев
 * теория чисел» lands on «Теория чисел | Алексей Савватеев» with all three
 * words lit and the bar between them not, which is the difference between a
 * result that explains itself and one that looks arbitrary.
 */
export function matchRanges(name: string, raw: string): Array<[number, number]> {
  const { text, source } = normalizeWithMap(name);
  if (!text) return [];

  const spanOf = (at: number, length: number): [number, number] => [
    source[at],
    source[at + length - 1] + 1,
  ];

  for (const variant of queryVariants(raw)) {
    if (!variant) continue;

    const phrase: Array<[number, number]> = [];
    let at = text.indexOf(variant);
    while (at !== -1) {
      phrase.push(spanOf(at, variant.length));
      at = text.indexOf(variant, at + variant.length);
    }
    if (phrase.length) return phrase;

    const tokens = tokensOf(variant);
    if (tokens.length < 2) continue;
    const marks: Array<[number, number]> = [];
    for (const token of tokens) {
      // A one-letter word would mark every «и» in the title, which is noise
      // wearing the costume of an explanation.
      if (token.length < 2) continue;
      let from = text.indexOf(token);
      while (from !== -1) {
        marks.push(spanOf(from, token.length));
        from = text.indexOf(token, from + token.length);
      }
    }
    if (marks.length) return merge(marks);
  }
  return [];
}

/** Sorted, and with overlaps folded together — what `MarkedText` walks. */
function merge(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/* ───────────────────────────────  Matching  ────────────────────────────── */

/** Type order in the output: playlists last — there are many and they are noisy. */
const TYPE_RANK: Record<SearchEntry['t'], number> = { d: 0, c: 1, v: 2, l: 3, p: 4 };

export const SEARCH_SECTION_ORDER: Array<SearchEntry['t']> = ['d', 'c', 'p', 'v', 'l'];

const EXACT = 1000;
const WORD_PREFIX = 600;
const PREFIX = 400;
const INSIDE = 150;

/**
 * What a match on separate words is worth against a match on the phrase.
 *
 * Half, and the half is load-bearing: `EXACT * TOKEN_FACTOR` is 500, which is
 * below `WORD_PREFIX`. So a row found because its words happen to be scattered
 * through a long title can never outrank a row whose title actually begins with
 * what was typed — the loose pass adds answers under the strict one instead of
 * rearranging it.
 */
const TOKEN_FACTOR = 0.5;

/** Score of one haystack against one already-normalised needle, 0 = no match. */
function fieldScore(haystack: string, needle: string): number {
  if (!haystack) return 0;
  if (haystack === needle) return EXACT;
  if (haystack.startsWith(needle)) return PREFIX;
  // A match at a word boundary beats a match in the middle of a word.
  const atWord = haystack.includes(` ${needle}`);
  if (atWord) return WORD_PREFIX;
  if (haystack.includes(needle)) return INSIDE;
  return 0;
}

/**
 * The words of an already-normalised query.
 *
 * Memoised on the last query because this is asked once per entry and the
 * catalogue is nine thousand of them — the same three-word string split nine
 * thousand times a keystroke.
 */
let lastQuery = '';
let lastTokens: string[] = [];
function tokensOf(needle: string): string[] {
  if (needle !== lastQuery) {
    lastQuery = needle;
    lastTokens = needle.split(' ').filter(Boolean);
  }
  return lastTokens;
}

/**
 * Every word of the query has to land somewhere, and the score is what they
 * averaged. Nothing else models the query people actually type: «савватеев
 * теория чисел» is three facts about one recording — a lecturer, a subject, and
 * that they go together — and the recording is titled with them in the other
 * order, split across the title and the channel.
 *
 * The conjunction is what keeps it from becoming a different search. Any one
 * word of a three-word query matches hundreds of playlists; all three match the
 * handful that are being asked for, and a query whose rarest word is rare stays
 * as precise as that word.
 *
 * `scoreOf` says where a word is allowed to be found: over one string when a
 * name is being explained, over the whole entry when it is being ranked.
 */
function tokenScore(tokens: string[], scoreOf: (token: string) => number): number {
  let total = 0;
  for (const token of tokens) {
    const best = scoreOf(token);
    if (!best) return 0;
    total += best;
  }
  return (total / tokens.length) * TOKEN_FACTOR;
}

/**
 * One string against a query: the phrase if it is there, else its words.
 *
 * The same two passes `scoreEntry` makes, over a single haystack — so a name
 * and an alias are judged by the rule the ranking used, and «why is this row
 * here» keeps one answer instead of two.
 */
function textScore(haystack: string, needle: string, tokens: string[]): number {
  const phrase = fieldScore(haystack, needle);
  if (phrase || tokens.length < 2) return phrase;
  return tokenScore(tokens, (token) => fieldScore(haystack, token));
}

/**
 * `normalize` over a name, remembered.
 *
 * The name is the one field the index ships unnormalised — it is printed, so it
 * has to stay as it was written — and normalising it inside the ranking loop
 * meant three regular expressions per entry per keystroke, which measured as
 * most of the cost of a search over 9000 entries. The map is weak because the
 * entries are the catalogue's, not this module's: switching interface language
 * replaces them and nothing here should keep the old ones alive.
 */
const NORMALIZED = new WeakMap<SearchEntry, string>();
function normalizedName(entry: SearchEntry): string {
  let name = NORMALIZED.get(entry);
  if (name === undefined) {
    name = normalize(entry.n);
    NORMALIZED.set(entry, name);
  }
  return name;
}

/** The best any one field of an entry does against one needle. */
function bestFieldScore(entry: SearchEntry, needle: string): number {
  let best = fieldScore(normalizedName(entry), needle);
  if (best >= EXACT) return best;
  for (const keyword of entry.k) {
    const score = fieldScore(keyword, needle);
    if (score > best) best = score;
    if (best >= EXACT) break;
  }
  return best;
}

/**
 * The other name that put this row in the list, when its own name did not.
 *
 * Half the catalogue's recordings are titled with a name that is not the
 * catalogue's, so a query is often somebody's own course name — «ТФКП»,
 * «теормех», «сопромат» — landing on a row that says something else entirely.
 * Without this the dropdown answers a question nobody asked and highlights
 * nothing, which reads as a mistake rather than as a match.
 *
 * Null when the name itself matched: the highlight already explains that one,
 * and repeating it would put the same word on the line twice.
 */
export function matchedAlias(entry: SearchEntry, raw: string): string | null {
  if (!entry.a?.length) return null;
  for (const variant of queryVariants(raw)) {
    if (!variant) continue;
    const tokens = tokensOf(variant);
    if (textScore(normalizedName(entry), variant, tokens) > 0) return null;
    const hit = entry.a.find((alias) => textScore(normalize(alias), variant, tokens) > 0);
    if (hit) return hit;
  }
  return null;
}

export type Scored = { entry: SearchEntry; score: number };

/**
 * Ranks one entry against a normalised query. Keywords are compared as
 * prefixes, which is what makes `мат` find `математика`, `математический` and
 * `матанализ` without any stemming.
 *
 * Two passes, in that order of trust: the query as a phrase, then — only if the
 * phrase is not there whole — its words spread over the entry's fields. The
 * second pass is what makes a catalogue of somebody else's titles searchable
 * at all: half of them put the lecturer after the subject, or the subject after
 * the university, and «мфти матанализ» is nobody's title and everybody's query.
 *
 * A one-word query has nothing to spread, so the second pass is skipped and
 * ranking is exactly what it was.
 */
export function scoreEntry(
  entry: SearchEntry,
  needle: string,
  tokens: string[] = tokensOf(needle)
): number {
  let best = bestFieldScore(entry, needle);
  if (best < EXACT && tokens.length > 1) {
    best = Math.max(best, tokenScore(tokens, (token) => bestFieldScore(entry, token)));
  }
  if (best === 0) return 0;
  // Type is the tiebreaker inside equal textual relevance, weight nudges within a type.
  return best * 10 - TYPE_RANK[entry.t] + (entry.s ?? 0) / 1000;
}

export function searchEntries(entries: SearchEntry[], raw: string, limit = 200): Scored[] {
  for (const variant of queryVariants(raw)) {
    const tokens = tokensOf(variant);
    const hits: Scored[] = [];
    for (const entry of entries) {
      const score = scoreEntry(entry, variant, tokens);
      if (score > 0) hits.push({ entry, score });
    }
    if (hits.length) {
      hits.sort((a, b) => b.score - a.score || a.entry.n.localeCompare(b.entry.n));
      return hits.slice(0, limit);
    }
  }
  return [];
}

/**
 * The playlist a link names, by exact id.
 *
 * Nothing about this goes through the ranking: an id is not a word, and the one
 * comparison that answers a link is `===` on the id YouTube wrote. Lower-casing
 * it — which every other path here does — would fold two different playlists
 * together and answer with whichever came first in the file.
 */
export function findPlaylist(entries: SearchEntry[], id: string): SearchEntry | null {
  return entries.find((entry) => entry.t === 'p' && entry.id === id) ?? null;
}

/**
 * Groups ranked hits into the sections the dropdown renders.
 *
 * What does not fit `perSection` is simply not there. A count of the rest —
 * «и ещё 39» — named a number nothing could be done about: no row to press,
 * and a query that already found its answer at the top of the list read as
 * having missed thirty-nine better ones.
 */
export function groupBySection(
  hits: Scored[],
  perSection: number
): Array<{ type: SearchEntry['t']; items: Scored[] }> {
  const buckets = new Map<SearchEntry['t'], Scored[]>();
  for (const hit of hits) {
    const list = buckets.get(hit.entry.t) ?? [];
    list.push(hit);
    buckets.set(hit.entry.t, list);
  }
  return SEARCH_SECTION_ORDER.filter((type) => buckets.has(type)).map((type) => ({
    type,
    items: buckets.get(type)!.slice(0, perSection),
  }));
}
