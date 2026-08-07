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

    /*
     * A row that leads nowhere is worse than one row fewer. «Алексей Савватеев
     * — 0 плейлистов» is a name matching an index the catalogue no longer has
     * anything behind: selecting it switches on a filter that empties the list.
     * Courses and playlists are always reachable, so only the two facets that
     * can go empty are checked.
     */
    const reachable = ({ entry }: Scored): boolean => {
      if (entry.t === 'v') return (catalog.providers[entry.id]?.playlistCount ?? 0) > 0;
      if (entry.t === 'l') return (entry.s ?? 0) > 0;
      if (entry.t === 'd') return (catalog.domainById.get(entry.id)?.courseCount ?? 0) > 0;
      return true;
    };

    const hits = searchEntries(catalog.search, query).filter(reachable);
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
