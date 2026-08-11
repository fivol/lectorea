import { useMemo } from 'react';
import type { SearchEntry } from '@shared/schema';
import { groupBySection, searchEntries, type Scored } from '@shared/search';
import { useCatalog } from './catalog';
import type { Catalog } from './data';

export const PER_SECTION = 5;
/**
 * The panel before anything is typed is a menu, not a result list. Three rows
 * a section is what keeps all three sections — and the line under them — on
 * screen at once on a laptop, which is the whole point of the default list.
 */
export const PER_SUGGESTED_SECTION = 3;

/**
 * What the empty panel offers, in the order it shows them.
 *
 * Exactly the three kinds the placeholder promises, so the field proves its own
 * claim instead of asking to be trusted. Playlists and lecturers are found by
 * name rather than browsed — a top four of either says nothing about what the
 * catalogue holds — so that they are searchable at all is said in one line
 * under the list instead of in two more sections.
 */
const SUGGESTED_TYPES: Array<SearchEntry['t']> = ['d', 'c', 'v'];

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
  /** Nothing was typed: the sections are defaults rather than hits. */
  suggested: boolean;
};

/*
 * A row that leads nowhere is worse than one row fewer. «Алексей Савватеев
 * — 0 плейлистов» is a name matching an index the catalogue no longer has
 * anything behind: selecting it switches on a filter that empties the list.
 * Courses and playlists are always reachable, so only the facets that can go
 * empty are checked.
 */
function reachable(catalog: Catalog, entry: SearchEntry): boolean {
  if (entry.t === 'v') return (catalog.providers[entry.id]?.playlistCount ?? 0) > 0;
  if (entry.t === 'l') return (entry.s ?? 0) > 0;
  if (entry.t === 'd') return (catalog.domainById.get(entry.id)?.courseCount ?? 0) > 0;
  return true;
}

/**
 * The default panel: the biggest of each kind, by the same weight the index
 * already carries — courses per domain, playlists per course, playlists per
 * provider. Ranking suggestions by anything else would need a second index.
 */
function useSuggested(catalog: Catalog): SearchResults {
  return useMemo(() => {
    const sections = SUGGESTED_TYPES.map((type) => {
      const items = catalog.search
        .filter((entry) => entry.t === type && reachable(catalog, entry))
        .map((entry) => ({ entry, score: entry.s ?? 0 }))
        .sort((a, b) => b.score - a.score || a.entry.n.localeCompare(b.entry.n))
        .slice(0, PER_SUGGESTED_SECTION);
      return { type, items, more: 0 };
    }).filter((section) => section.items.length > 0);

    return {
      query: '',
      hits: [],
      sections,
      flat: sections.flatMap((section) => section.items.map((item) => item.entry)),
      // Nothing is being searched for yet, so nothing on the map is a match.
      matchedDomains: new Set<string>(),
      empty: sections.length === 0,
      suggested: true,
    };
  }, [catalog]);
}

export function useSearchResults(query: string): SearchResults {
  const catalog = useCatalog();
  const suggested = useSuggested(catalog);

  const found = useMemo(() => {
    if (!query.trim()) return null;

    const hits = searchEntries(catalog.search, query).filter(({ entry }) =>
      reachable(catalog, entry)
    );
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
      suggested: false,
    };
  }, [catalog, query]);

  return found ?? suggested;
}
