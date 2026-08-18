import { useEffect, useMemo, useRef } from 'react';
import type { SearchEntry } from '@shared/schema';
import { groupBySection, searchEntries, type Scored } from '@shared/search';
import { searchTerm, track } from './analytics';
import { useCatalog } from './catalog';
import type { Catalog } from './data';

export const PER_SECTION = 5;

/**
 * What the empty panel offers, and in what order — it depends on where the
 * field is, because so does the question being asked.
 *
 * On the map nothing has been chosen yet, so the panel names the three kinds
 * the placeholder promises and the field proves its own claim instead of asking
 * to be trusted. In the columns the choosing has already happened: the screen
 * is a slice of the catalogue, and the largest field of knowledge overall is
 * not an answer to anything there — what is in *this* slice is.
 */
export const SUGGEST_ON_MAP: Array<SearchEntry['t']> = ['d', 'c', 'v'];
export const SUGGEST_IN_SLICE: Array<SearchEntry['t']> = ['c', 'p'];

/**
 * The panel before anything is typed is a menu, not a result list, and it
 * should be about one size wherever it opens — so fewer kinds means longer
 * sections. Three sections of three, or two of five, both leave the line under
 * them on screen at once on a laptop.
 */
const perSuggestedSection = (kinds: number): number => (kinds > 2 ? 3 : 5);

export type SearchSection = {
  type: SearchEntry['t'];
  items: Scored[];
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
 * provider, rating for a playlist. Ranking suggestions by anything else would
 * need a second index.
 *
 * `courses`, when given, is the slice the screen is currently showing: the
 * suggestions stay inside it, so they are the same catalogue the columns
 * behind the panel are. Typing still searches everything — the filter says
 * what to look at, not what exists.
 */
function useSuggested(
  catalog: Catalog,
  kinds: Array<SearchEntry['t']>,
  courses: Set<string> | undefined
): SearchResults {
  return useMemo(() => {
    const inSlice = (entry: SearchEntry): boolean => {
      if (!courses) return true;
      if (entry.t === 'c') return courses.has(entry.id);
      if (entry.t === 'p') return Boolean(entry.c && courses.has(entry.c));
      return true;
    };

    const limit = perSuggestedSection(kinds.length);
    const sections = kinds
      .map((type) => {
        const items = catalog.search
          .filter((entry) => entry.t === type && reachable(catalog, entry) && inSlice(entry))
          .map((entry) => ({ entry, score: entry.s ?? 0 }))
          .sort((a, b) => b.score - a.score || a.entry.n.localeCompare(b.entry.n))
          .slice(0, limit);
        return { type, items };
      })
      .filter((section) => section.items.length > 0);

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
  }, [catalog, kinds, courses]);
}

/**
 * @param suggest what the panel offers before anything is typed — which kinds,
 * and the slice of courses the screen is currently showing.
 */
export function useSearchResults(
  query: string,
  suggest: { kinds?: Array<SearchEntry['t']>; courses?: Set<string> } = {}
): SearchResults {
  const catalog = useCatalog();
  const suggested = useSuggested(catalog, suggest.kinds ?? SUGGEST_ON_MAP, suggest.courses);

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

  useSearchReport(found);
  return found ?? suggested;
}

/** Long enough that «теорв» is not counted on the way to «теорвер». */
const SETTLE_MS = 900;

/**
 * A search, counted once it has stopped being typed.
 *
 * Both screens search through `useSearchResults`, so this is the one place it
 * can be reported from — and the one place the rule about free text has to
 * hold. What goes is the query as a *subject*, put through `searchTerm`, which
 * lower-cases it, refuses anything of a length nobody asks a catalogue, and
 * refuses anything shaped like an address or a phone number; a search whose
 * words are dropped is still counted, so the totals stay true.
 *
 * The zero-result case gets an event of its own because it is the one signal
 * the catalogue cannot get any other way. A refusal in the pipeline says a
 * playlist did not match a course we have; this says somebody wanted a course
 * we do not — which is exactly the question `_gaps.ts` is run to answer, and
 * the only version of it that comes from readers rather than from the crawl.
 */
function useSearchReport(found: SearchResults | null): void {
  const last = useRef('');
  const query = found?.query ?? '';
  const hits = found?.hits.length ?? 0;

  useEffect(() => {
    const term = query.trim();
    // Two characters is a prefix on the way to a word, not a question.
    if (term.length < 2 || term === last.current) return;
    const timer = setTimeout(() => {
      last.current = term;
      const safe = searchTerm(term);
      track('search', { search_term: safe, results: hits });
      if (hits === 0) track('search_no_results', { search_term: safe });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [query, hits]);
}
