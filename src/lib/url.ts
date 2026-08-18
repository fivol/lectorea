import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { track } from './analytics';
import { useCatalog } from './catalog';

/**
 * Everything shareable lives in the URL: the domain filter, the global provider
 * filter and the open playlist. That is what makes the browser back button work
 * and a pasted link land on the same view.
 */

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export type CatalogParams = {
  domains: string[];
  providers: string[];
  /** Global lecturer filter — behaves exactly like the provider one. */
  lecturers: string[];
  playlistId: string | null;
  setDomains: (next: string[]) => void;
  toggleDomain: (id: string) => void;
  setProviders: (next: string[]) => void;
  toggleProvider: (id: string) => void;
  toggleLecturer: (name: string) => void;
  clearGlobalFilters: () => void;
  setPlaylist: (id: string | null) => void;
  /** Query string to carry filters across a navigation. */
  search: string;
};

export function useCatalogParams(): CatalogParams {
  const [params, setParams] = useSearchParams();

  const domains = useMemo(() => parseList(params.get('domain')), [params]);
  const providers = useMemo(() => parseList(params.get('provider')), [params]);
  const lecturers = useMemo(() => parseList(params.get('lecturer')), [params]);
  const playlistId = params.get('playlist');

  const write = useCallback(
    (key: string, value: string[] | string | null, replace = false) => {
      const next = new URLSearchParams(params);
      const serialised = Array.isArray(value) ? value.join(',') : value;
      if (!serialised) next.delete(key);
      else next.set(key, serialised);
      setParams(next, { replace });
    },
    [params, setParams]
  );

  const toggle = useCallback(
    (key: string, current: string[], id: string) => {
      const on = !current.includes(id);
      const next = on ? [...current, id] : current.filter((item) => item !== id);
      // The three filters that live above both screens, counted here because
      // this is the one function all of them are toggled through — the map, the
      // columns, the search panel and the playlist rows all end up in it. Only
      // `domain` reaches the canonical path and so only `domain` is visible in
      // a page view; the other two would be invisible without this.
      track('filter_apply', { facet: key, value: on ? id : '', on });
      write(key, next);
    },
    [write]
  );

  const clearGlobalFilters = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete('provider');
    next.delete('lecturer');
    setParams(next);
  }, [params, setParams]);

  return {
    domains,
    providers,
    lecturers,
    playlistId,
    setDomains: (next) => write('domain', next),
    toggleDomain: (id) => toggle('domain', domains, id),
    setProviders: (next) => write('provider', next),
    toggleProvider: (id) => toggle('provider', providers, id),
    toggleLecturer: (name) => toggle('lecturer', lecturers, name),
    clearGlobalFilters,
    // The modal is a view of the current page, not a place — replace the entry
    // so closing it does not require two presses of the back button.
    setPlaylist: (id) => write('playlist', id, true),
    search: params.toString() ? `?${params.toString()}` : '',
  };
}

/** Builds `/courses/:id` while carrying the current filters along. */
export function courseHref(courseId: string, search: string): string {
  return `/courses/${encodeURIComponent(courseId)}${search}`;
}

export function coursesHref(search: string): string {
  return `/courses${search}`;
}

/**
 * The current query string with the domain filter pointed at `domainIds` and
 * everything else about the view left alone — the provider and lecturer
 * filters live above both screens, so moving between fields must not drop them.
 */
export function withDomains(search: string, domainIds: string[]): string {
  const query = new URLSearchParams(search);
  if (domainIds.length) query.set('domain', domainIds.join(','));
  else query.delete('domain');
  const serialised = query.toString();
  return serialised ? `?${serialised}` : '';
}

/**
 * The columns opened on one field of knowledge — what a territory on the map,
 * a block, and a field in the search panel all lead to.
 *
 * Each of the three used to write `/courses?domain=…` by hand, which threw away
 * the query string it was standing in: the provider and lecturer chips are set
 * on the map, live above both screens and are meant to survive the crossing,
 * and pressing a continent silently cleared them. A filter that vanishes
 * without being asked is worse than one that is forgotten — nothing on the next
 * screen says it ever existed.
 *
 * The open playlist does not come along: it belongs to a course, and a field is
 * entered with nothing selected in it.
 */
export function fieldHref(search: string, domainId: string): string {
  const query = new URLSearchParams(withDomains(search, [domainId]));
  query.delete('playlist');
  const serialised = query.toString();
  return coursesHref(serialised ? `?${serialised}` : '');
}

/**
 * The same course, read in another field: the domain filter is pointed at one
 * domain and everything else about the view is left alone.
 *
 * This is the way out of a course that was opened from outside the current
 * filter — the card says which field it came from, and one press moves the
 * columns there with the course still selected.
 */
export function domainHref(courseId: string, search: string, domainId: string): string {
  return courseHref(courseId, withDomains(search, [domainId]));
}

/**
 * The view a course reached from outside the columns — the search panel, the
 * profile — should open in: its own fields of knowledge, filter and all.
 *
 * Without it the columns opened on the whole catalogue: the one course asked
 * for, and every other one around it, which is the screen you get for asking
 * nothing at all. Its domains are the smallest slice that still holds it, and
 * all of them go in rather than the primary one alone — «Теория графов» is
 * maths *and* computer science, and dropping the second would put half of what
 * it leads to outside the filter it was just opened in.
 *
 * A filter already set is left alone. On the columns it is something someone
 * chose, and arriving from a search or a favourite is a look at one card rather
 * than a request to move the whole screen — the guest card is what carries a
 * course in from outside the filter.
 */
export function useCourseSlice(): (courseId: string) => string {
  const catalog = useCatalog();
  const { domains, search } = useCatalogParams();

  return useCallback(
    (courseId: string) =>
      domains.length
        ? search
        : withDomains(search, catalog.courseById.get(courseId)?.domains ?? []),
    [catalog, domains, search]
  );
}
