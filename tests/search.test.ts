import { describe, expect, it } from 'vitest';
import type { SearchEntry } from '../shared/schema';
import {
  findPlaylist,
  groupBySection,
  matchRanges,
  normalize,
  queryVariants,
  searchEntries,
  swapLayout,
  translit,
} from '../shared/search';

/**
 * Normalisation is shared by the build (which normalises keywords) and the
 * client (which normalises what is typed). If the two ever disagree, keywords
 * written by hand silently stop matching — which is invisible until someone
 * complains that search is broken.
 */

describe('normalize', () => {
  it('folds ё to е so both spellings match', () => {
    expect(normalize('Шрёдингер')).toBe('шредингер');
  });

  it('lowercases and collapses whitespace', () => {
    expect(normalize('  Теория   Вероятностей ')).toBe('теория вероятностей');
  });

  it('drops punctuation but keeps digits', () => {
    expect(normalize('Матанализ, часть 2!')).toBe('матанализ часть 2');
  });
});

describe('keyboard layout correction', () => {
  it('turns latin gibberish into the russian word', () => {
    expect(swapLayout('vfntvfnbrf')).toBe('математика');
  });

  it('turns russian gibberish back into latin', () => {
    // What «math» becomes when the keyboard was left in the Russian layout.
    expect(swapLayout('ьфер')).toBe('math');
  });
});

describe('transliteration', () => {
  it('maps a plain word', () => {
    expect(translit('matematika')).toBe('математика');
  });

  it('prefers longer digraphs', () => {
    expect(translit('shar')).toBe('шар');
    expect(translit('zhuk')).toBe('жук');
  });
});

describe('query variants', () => {
  it('tries the raw query first', () => {
    expect(queryVariants('математика')[0]).toBe('математика');
  });

  it('offers the layout-swapped form as a fallback', () => {
    expect(queryVariants('vfntvfnbrf')).toContain('математика');
  });

  it('is empty for an empty query', () => {
    expect(queryVariants('   ')).toEqual([]);
  });
});

/* ────────────────────────────────  Ranking  ────────────────────────────── */

const entries: SearchEntry[] = [
  { t: 'd', id: 'math', n: 'Математика', k: ['математика', 'матан', 'мат'], s: 20 },
  { t: 'c', id: 'probability', n: 'Теория вероятностей', k: ['теорвер', 'вероятность'], s: 3 },
  { t: 'c', id: 'calculus-1', n: 'Математический анализ 1', k: ['матанализ', 'матан'], s: 5 },
  { t: 'p', id: 'PL1', n: 'Матанализ — МФТИ', k: ['матанализ мфти'], s: 900 },
  { t: 'v', id: 'mipt', n: 'МФТИ', k: ['мфти'], s: 200 },
  // Titled by whoever published it: the subject in the name, the lecturer only
  // in the channel. Neither field holds the query anybody would type for it.
  { t: 'p', id: 'PL2', n: 'Лекции по теории вероятностей', k: ['лекции по теории вероятностей', 'савватеев'], s: 100 },
];

describe('search', () => {
  it('finds by prefix, so «мат» reaches «математика»', () => {
    const ids = searchEntries(entries, 'мат').map((hit) => hit.entry.id);
    expect(ids).toContain('math');
    expect(ids).toContain('calculus-1');
  });

  it('finds a course through a slang keyword', () => {
    expect(searchEntries(entries, 'теорвер')[0].entry.id).toBe('probability');
  });

  it('finds through a wrong keyboard layout', () => {
    expect(searchEntries(entries, 'ntjhdth')[0].entry.id).toBe('probability');
  });

  it('ranks an exact match above a partial one', () => {
    expect(searchEntries(entries, 'математика')[0].entry.id).toBe('math');
  });

  it('puts playlists last — there are many and they are noisy', () => {
    const types = searchEntries(entries, 'матанализ').map((hit) => hit.entry.t);
    expect(types.indexOf('p')).toBeGreaterThan(types.indexOf('c'));
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchEntries(entries, 'квакozябра')).toEqual([]);
  });
});

describe('sections', () => {
  it('caps each section and drops the overflow', () => {
    const many: SearchEntry[] = Array.from({ length: 9 }, (_, index) => ({
      t: 'c' as const,
      id: `c${index}`,
      n: `Курс ${index}`,
      k: ['курс'],
    }));
    const [section] = groupBySection(searchEntries(many, 'курс'), 5);
    expect(section.items).toHaveLength(5);
  });

  it('keeps the section order: domains, courses, playlists, vendors, lecturers', () => {
    const order = groupBySection(searchEntries(entries, 'мфти'), 5).map((s) => s.type);
    expect(order.indexOf('p')).toBeLessThan(order.indexOf('v'));
  });
});

/* ─────────────────────────  Words, not phrases  ────────────────────────── */

/**
 * Half the catalogue's recordings are titled by somebody who was not writing a
 * catalogue entry: the lecturer after the subject, the university in the
 * channel name, a semester in brackets. A query is the same facts in whatever
 * order they came to mind, so the phrase is tried first and the words after it.
 */

describe('matching by words', () => {
  it('finds a recording whose title has the words in the other order', () => {
    expect(searchEntries(entries, 'мфти матанализ')[0].entry.id).toBe('PL1');
  });

  it('collects the words from different fields — the title and the channel', () => {
    expect(searchEntries(entries, 'савватеев вероятностей')[0].entry.id).toBe('PL2');
  });

  it('needs every word: one that lands nowhere refuses the row', () => {
    expect(searchEntries(entries, 'мфти квакозябра')).toEqual([]);
  });

  it('keeps a phrase above a row that only has the words scattered', () => {
    // «Математический анализ 1» holds the phrase; the playlist holds the two
    // words with a dash between them and a university after.
    const [first] = searchEntries(entries, 'математический анализ');
    expect(first.entry.id).toBe('calculus-1');
  });

  it('leaves a one-word query exactly as it was', () => {
    expect(searchEntries(entries, 'теорвер')[0].entry.id).toBe('probability');
  });
});

describe('highlighting', () => {
  it('marks the phrase when it is there whole', () => {
    expect(matchRanges('Теория вероятностей', 'вероятност')).toEqual([[7, 17]]);
  });

  it('marks each word when the phrase is not', () => {
    // A row found by its words has to be able to show which ones — an unmarked
    // hit is indistinguishable from a bug.
    expect(matchRanges('Матанализ — МФТИ', 'мфти матанализ')).toEqual([
      [0, 9],
      [12, 16],
    ]);
  });

  it('marks nothing for words that are not in the name', () => {
    expect(matchRanges('Лекции по теории вероятностей', 'савватеев квакозябра')).toEqual([]);
  });
});

/* ───────────────────────────  Pasted addresses  ────────────────────────── */

describe('finding a playlist by id', () => {
  it('finds the entry a link names', () => {
    expect(findPlaylist(entries, 'PL1')?.n).toBe('Матанализ — МФТИ');
  });

  it('is case-sensitive, because two ids differing only in case are two playlists', () => {
    expect(findPlaylist(entries, 'pl1')).toBeNull();
  });

  it('never answers with a course that happens to share the id', () => {
    expect(findPlaylist(entries, 'probability')).toBeNull();
  });
});
