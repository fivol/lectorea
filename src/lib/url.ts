import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

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
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
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
 * The same course, read in another field: the domain filter is pointed at one
 * domain and everything else about the view is left alone.
 *
 * This is the way out of a course that was opened from outside the current
 * filter — the card says which field it came from, and one press moves the
 * columns there with the course still selected.
 */
export function domainHref(courseId: string, search: string, domainId: string): string {
  const query = new URLSearchParams(search);
  query.set('domain', domainId);
  return courseHref(courseId, `?${query.toString()}`);
}
