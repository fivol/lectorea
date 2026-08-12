import { describe, expect, it } from 'vitest';
import type { SearchEntry } from '../shared/schema';
import {
  groupBySection,
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
