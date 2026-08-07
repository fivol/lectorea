import { useMemo } from 'react';
import type { SearchEntry } from '@shared/schema';
import { groupBySection, searchEntries, type Scored } from '@shared/search';
import { useCatalog } from './catalog';

export const PER_SECTION = 5;

export type SearchSection = {
  type: SearchEntry['t'];
  items: Scored[];
  more: number;
};

export type SearchResults = {
  query: string;
  hits: Scored[];
  sections: SearchSection[];
  /** Flattened list in render order — what ↑/↓ walks through. */
  flat: SearchEntry[];
  /** Domains to light up on the map while typing. */
  matchedDomains: Set<string>;
  empty: boolean;
};

const EMPTY: SearchResults = {
  query: '',
  hits: [],
  sections: [],
  flat: [],
  matchedDomains: new Set(),
  empty: false,
};

export function useSearchResults(query: string): SearchResults {
  const catalog = useCatalog();

  return useMemo(() => {
    if (!query.trim()) return EMPTY;

    const hits = searchEntries(catalog.search, query);
    const sections = groupBySection(hits, PER_SECTION);
    const flat = sections.flatMap((section) => section.items.map((item) => item.entry));

    // Highlighting is live and covers everything the query touches, not only
    // the five entries the dropdown has room for.
    const matchedDomains = new Set<string>();
    for (const { entry } of hits) {
      if (entry.t === 'd') {
        matchedDomains.add(entry.id);
      } else if (entry.t === 'c') {
        for (const domain of catalog.courseById.get(entry.id)?.domains ?? []) {
          matchedDomains.add(domain);
        }
      } else if (entry.t === 'p' && entry.c) {
        for (const domain of catalog.courseById.get(entry.c)?.domains ?? []) {
          matchedDomains.add(domain);
        }
      } else if (entry.t === 'v') {
        for (const domain of catalog.providers[entry.id]?.domainIds ?? []) {
          matchedDomains.add(domain);
        }
      }
    }

    return {
      query,
      hits,
      sections,
      flat,
      matchedDomains,
      empty: hits.length === 0,
    };
  }, [catalog, query]);
}
