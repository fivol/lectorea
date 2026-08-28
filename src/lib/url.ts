import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { track } from './analytics';
import { useCatalog } from './catalog';

/**
 * Everything shareable lives in the URL: the domain filter, the global provider
 * filter and the open playlist. That is what makes the browser back button work
 * and a pasted link land on the same view.
 *
 * The domain filter is the one of the three that also decides the **address**.
 * One field of knowledge and nothing else selected is a place — `/fields/math`
 * — and every other combination is a way of looking at the columns, which is a
 * query string on `/courses`. The distinction is not cosmetic: a static host
 * serves one file per path and cannot vary on a query string, so while a field
 * was `/courses?domain=math` all thirty-nine of them were the same bytes with
 * the same title until the bundle had run, and a crawler that indexes what it
 * is served had thirty-nine copies of one page. `scripts/prerender.ts` writes a
 * real page per field, and this is the module that points at it.
 *
 * `?domain=` keeps working — it is what every link shared so far says — and
 * the canonical link of the view it opens names the `/fields/…` form, so the
 * two never compete.
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
  const navigate = useNavigate();
  const location = useLocation();
  const catalog = useCatalog();
  /**
   * Which of the two shapes the current address is in. `domainId` is set by the
   * `/fields/:domainId` route and `courseId` by `/courses/:courseId`; on the map
   * and on the bare columns both are absent.
   */
  const { courseId, domainId } = useParams<{ courseId?: string; domainId?: string }>();

  const providers = useMemo(() => parseList(params.get('provider')), [params]);
  const lecturers = useMemo(() => parseList(params.get('lecturer')), [params]);
  const playlistId = params.get('playlist');

  /**
   * The fields of knowledge the columns are looking through.
   *
   * Normally the address says: a `/fields/<id>` path, or a `domain=` list on
   * `/courses`. The exception is a course reached by its bare address —
   * `/courses/inorganic-chemistry`, which is what a search result and a shared
   * link are — where nothing has been chosen and the honest answer, all 225
   * cards across nine columns of every subject, is the one view that answers no
   * question. Such a course brings its own fields with it, the same slice the
   * search box and the profile already open it in (`useCourseSlice`).
   *
   * Derived here rather than corrected afterwards. An effect that rewrote the
   * address would run after the first render, so the wall was drawn, painted
   * and then rebuilt into the field — visible, and the expensive half of it
   * wasted. The URL is left alone: `/courses/<id>` stays the clean canonical
   * address it is in the sitemap, and the moment the reader touches a filter
   * `writeDomains` writes down whatever they chose.
   */
  const domains = useMemo(() => {
    if (domainId) return [domainId];
    const named = parseList(params.get('domain'));
    if (named.length || providers.length || lecturers.length) return named;
    return courseId ? catalog.courseById.get(courseId)?.domains ?? [] : [];
  }, [catalog, courseId, domainId, lecturers, params, providers]);

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
      // The filters that live above both screens, counted here because this is
      // the one function they are toggled through — the columns, the search
      // panel and the playlist rows all end up in it. Neither of them shows up
      // in a page view on its own, so without this they would be invisible;
      // `domain` is counted in `writeDomains`, which is where it is written now
      // that it moves the address rather than the query string.
      track('filter_apply', { facet: key, value: on ? id : '', on });
      write(key, next);
    },
    [write]
  );

  /**
   * The domain filter, written wherever it belongs for the result.
   *
   * A course keeps its own address and carries the filter in the query, as it
   * always did. Otherwise the columns are the page and the filter is what the
   * page *is*: exactly one field is `/fields/<id>`, none or several is
   * `/courses`. Which means no screen has to know about the split — this is
   * the only function that writes `domain`.
   */
  const writeDomains = useCallback(
    (next: string[]) => {
      if (courseId) {
        write('domain', next);
        return;
      }
      const query = new URLSearchParams(params);
      query.delete('domain');
      // Stale on the columns: a playlist is opened over a course, and there is
      // no course here to open it over.
      query.delete('playlist');
      if (next.length === 1) {
        navigate(`/fields/${encodeURIComponent(next[0])}${queryTail(query)}`);
        return;
      }
      if (next.length) query.set('domain', next.join(','));
      const tail = queryTail(query);
      navigate(tail ? `/courses${tail}` : '/');
    },
    [courseId, navigate, params, write]
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
    setDomains: writeDomains,
    toggleDomain: (id) => {
      const on = !domains.includes(id);
      // Counted here rather than in `toggle`, which the other two facets still
      // share: `domain` is the one that moves the address instead of the query.
      track('filter_apply', { facet: 'domain', value: on ? id : '', on });
      writeDomains(on ? [...domains, id] : domains.filter((item) => item !== id));
    },
    setProviders: (next) => write('provider', next),
    toggleProvider: (id) => toggle('provider', providers, id),
    toggleLecturer: (name) => toggle('lecturer', lecturers, name),
    clearGlobalFilters,
    // The modal is a layer over the current page, and a layer is what the
    // system back button closes: opening pushes an entry, so back closes the
    // player and lands on the course — on a phone the back gesture is how a
    // layer is closed, and it used to throw the reader out of the course
    // panel and the player at once. Switching parts inside an open player
    // replaces: however many parts were leafed through, the layer is one
    // entry deep, and one back is still one exit.
    setPlaylist: (id) => {
      const next = new URLSearchParams(params);
      if (id) next.set('playlist', id);
      else next.delete('playlist');
      if (id) {
        if (playlistId) setParams(next, { replace: true, state: location.state });
        else setParams(next, { state: { playlistLayer: true } });
        return;
      }
      // Closing mirrors how it opened. A pushed layer pops, so the × and the
      // back button are the same exit rather than two entries apart; a pasted
      // `?playlist=` link has nothing underneath and strips the param in
      // place — the one close that keeps that reader on the site.
      if ((location.state as { playlistLayer?: boolean } | null)?.playlistLayer) navigate(-1);
      else setParams(next, { replace: true });
    },
    /*
     * One string, whatever shape the address is in: a field of knowledge read
     * off the path comes back as `domain=…` here, because that is how every
     * other screen carries a filter across a navigation — a course opened from
     * `/fields/math` is `/courses/<id>?domain=math`, exactly as it was before
     * the field had a page of its own.
     */
    search: queryTail(withDomainParam(params, domains)),
  };
}

/** `?a=1&b=2`, or nothing at all — never a bare `?`. */
function queryTail(query: URLSearchParams): string {
  const serialised = query.toString();
  return serialised ? `?${serialised}` : '';
}

/** The query as it is, with the domain filter spelled out in it. */
function withDomainParam(params: URLSearchParams, domains: string[]): URLSearchParams {
  const query = new URLSearchParams(params);
  if (domains.length) query.set('domain', domains.join(','));
  else query.delete('domain');
  return query;
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
  const query = new URLSearchParams(search);
  // The field is the address now, so it must not also be in the query — one
  // page, one way of naming it.
  query.delete('domain');
  query.delete('playlist');
  return `/fields/${encodeURIComponent(domainId)}${queryTail(query)}`;
}

/**
 * The columns as a place to come back to — closing a course, pressing escape,
 * the chip that names the field a course belongs to.
 *
 * The same rule the domain filter is written by, read the other way round: a
 * query string that holds exactly one field is that field's page, and anything
 * else is the columns with a filter on them. Without it, leaving a course
 * landed on `/courses?domain=math` — the view is right, but it is the address
 * the field page exists to replace, and the site would go on producing it.
 */
export function columnsHref(search: string): string {
  const query = new URLSearchParams(search);
  const domains = parseList(query.get('domain'));
  if (domains.length === 1) {
    query.delete('domain');
    return `/fields/${encodeURIComponent(domains[0])}${queryTail(query)}`;
  }
  const tail = queryTail(query);
  // Nothing left to look at the columns *through*: that is the map, not a
  // screen with every card in the catalogue on it. See `CoursesScreen`.
  return tail ? `/courses${tail}` : '/';
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
