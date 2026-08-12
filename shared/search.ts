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
 */
export function matchRanges(name: string, raw: string): Array<[number, number]> {
  const { text, source } = normalizeWithMap(name);
  if (!text) return [];

  for (const variant of queryVariants(raw)) {
    if (!variant) continue;
    const ranges: Array<[number, number]> = [];
    let at = text.indexOf(variant);
    while (at !== -1) {
      const start = source[at];
      const end = source[at + variant.length - 1] + 1;
      ranges.push([start, end]);
      at = text.indexOf(variant, at + variant.length);
    }
    if (ranges.length) return ranges;
  }
  return [];
}

/* ───────────────────────────────  Matching  ────────────────────────────── */

/** Type order in the output: playlists last — there are many and they are noisy. */
const TYPE_RANK: Record<SearchEntry['t'], number> = { d: 0, c: 1, v: 2, l: 3, p: 4 };

export const SEARCH_SECTION_ORDER: Array<SearchEntry['t']> = ['d', 'c', 'p', 'v', 'l'];

const EXACT = 1000;
const WORD_PREFIX = 600;
const PREFIX = 400;
const INSIDE = 150;

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

export type Scored = { entry: SearchEntry; score: number };

/**
 * Ranks one entry against a normalised query. Keywords are compared as
 * prefixes, which is what makes `мат` find `математика`, `математический` and
 * `матанализ` without any stemming.
 */
export function scoreEntry(entry: SearchEntry, needle: string): number {
  let best = fieldScore(normalize(entry.n), needle);
  for (const keyword of entry.k) {
    best = Math.max(best, fieldScore(keyword, needle));
    if (best >= EXACT) break;
  }
  if (best === 0) return 0;
  // Type is the tiebreaker inside equal textual relevance, weight nudges within a type.
  return best * 10 - TYPE_RANK[entry.t] + (entry.s ?? 0) / 1000;
}

export function searchEntries(entries: SearchEntry[], raw: string, limit = 200): Scored[] {
  for (const variant of queryVariants(raw)) {
    const hits: Scored[] = [];
    for (const entry of entries) {
      const score = scoreEntry(entry, variant);
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
