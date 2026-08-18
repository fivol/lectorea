import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuiltCourse, BuiltPlaylist } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { loadPlaylistsCached } from '@/lib/data';
import { formatHours, hoursFromSeconds } from '@/lib/format';
import { suggestPlaylistUrl } from '@/lib/repo';
import { useCatalogParams } from '@/lib/url';
import { useProfile } from '@/store/profile';
import PlaylistFilters from './PlaylistFilters';
import PlaylistRow from './PlaylistRow';
import PlaylistModal from './PlaylistModal';
import { playlistHeadings } from './playlist-label';
import { groupRuns, runSeconds, type ListItem } from './series';
import { ButtonLink } from '@/components/ui';
import {
  applyFilters,
  defaultFilters,
  facetActive,
  langLabel,
  languageLabel,
  reportFilters,
  sortPlaylists,
  toggleFacet,
  type FilterFacet,
  type PlaylistFilterState,
  type SortKey,
} from './playlist-filters';

type Props = { course: BuiltCourse };

export default function PlaylistList({ course }: Props) {
  const { t, count, lang } = useT();
  const catalog = useCatalog();
  const profile = useProfile((state) => state.profile);
  const params = useCatalogParams();

  /**
   * The reader's own answer about which languages they want, or `null` if they
   * have never given one — see `defaultFilters`. Held in the profile rather
   * than in this component because the question it answers outlives the panel:
   * it is about them, not about the course that happens to be open.
   */
  const chosenLangs = useProfile((state) => state.profile.settings.playlistLangs);
  const setSetting = useProfile((state) => state.setSetting);

  const [playlists, setPlaylists] = useState<BuiltPlaylist[] | null>(null);
  const [filters, setFilters] = useState<PlaylistFilterState>(() =>
    defaultFilters(lang, chosenLangs)
  );
  const [sort, setSort] = useState<SortKey>('rating');
  /**
   * Whether a course cut into parts is drawn as one thing. On by default and
   * kept across courses like the sort is: it is a way of reading the list, not
   * an answer about this course, and having to tick it again on every panel
   * would make it useless.
   */
  const [grouped, setGrouped] = useState(true);
  const lastFocused = useRef<HTMLElement | null>(null);

  /*
   * The filters, counted once they have settled rather than as they are set.
   *
   * In an effect keyed on the state instead of inside `setFilters`, because
   * `setFilters` is also called with an updater function and React runs those
   * twice under StrictMode — an event sent from inside one would be sent twice
   * in development and once in production, which is the worst of the two.
   */
  const filtersBefore = useRef(filters);
  useEffect(() => {
    reportFilters(filtersBefore.current, filters);
    /*
     * And the language, written down where the next course will find it.
     *
     * Kept here, beside the diff that already knows what moved, rather than in
     * the language dropdown: the same state is set from the dropdown, from the
     * reset button and from the chip's own cross, and a rule repeated at three
     * controls is a rule that will be missing from the fourth. Seeding on a
     * course change writes the value it just read, so it cannot fire — only a
     * real change reaches this.
     */
    if (filtersBefore.current.langs.join(',') !== filters.langs.join(',')) {
      setSetting('playlistLangs', filters.langs);
    }
    filtersBefore.current = filters;
  }, [filters, setSetting]);

  /*
   * What the next course opens on, kept in a ref so that reading it is not a
   * reason to re-seed.
   *
   * The page's language is the starting point and not a leash: opening another
   * course starts from it again, but only until the reader has said otherwise,
   * and after that their answer is what a new course starts on. Switching the
   * header toggle leaves an open panel's filters alone either way — they are
   * the reader's, and the chip says which.
   */
  const seedRef = useRef({ lang, chosenLangs });
  seedRef.current = { lang, chosenLangs };

  useEffect(() => {
    let cancelled = false;
    setPlaylists(null);
    setFilters(defaultFilters(seedRef.current.lang, seedRef.current.chosenLangs));
    loadPlaylistsCached(course.id).then((loaded) => {
      if (cancelled) return;
      setPlaylists(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [course.id]);

  /**
   * What the list shows, and whether the language filter had to be lifted to
   * show it.
   *
   * A course with no recording in your language is a fact worth stating — so
   * the filter stays on, its chip stays in the strip, and the rest of the shard
   * comes up under a line that says nothing was found in that language. Only
   * the language is lifted: every other filter is still the user's answer to
   * «what am I looking for».
   */
  const { rows: visible, otherLangs } = useMemo(() => {
    if (!playlists) return { rows: [] as BuiltPlaylist[], otherLangs: false };
    const global = { providers: params.providers, lecturers: params.lecturers };
    const filtered = applyFilters(playlists, filters, profile, global, catalog.providers);
    if (filtered.length || !filters.langs.length) {
      return { rows: sortPlaylists(filtered, sort), otherLangs: false };
    }
    const rest = applyFilters(
      playlists,
      { ...filters, langs: [] },
      profile,
      global,
      catalog.providers
    );
    return { rows: sortPlaylists(rest, sort), otherLangs: rest.length > 0 };
  }, [playlists, filters, profile, params.providers, params.lecturers, catalog.providers, sort]);

  /**
   * Row headings are worked out over the whole shard, not over what survives
   * the filters: a name that changes as you tick boxes is worse than one that
   * is occasionally more specific than it needs to be.
   */
  const labels = useMemo(
    () =>
      playlistHeadings(playlists ?? [], t(`course.${course.id}.title`), {
        providerTitle: (id) => catalog.providers[id]?.title,
      }),
    [playlists, course.id, catalog.providers, t]
  );

  /**
   * The list as it is drawn: single recordings, and runs kept together.
   *
   * Runs are worked out over the whole shard rather than over what survives the
   * filters — see `groupRuns`. Ungrouped, the parts are ordinary rows and rank
   * against everything else, which is the honest view for anyone looking for
   * one recording rather than for a course to sit down with.
   */
  const items = useMemo<ListItem[]>(
    () =>
      grouped
        ? groupRuns(visible, playlists ?? visible)
        : visible.map((playlist) => ({ kind: 'one', playlist })),
    [visible, playlists, grouped]
  );

  /**
   * How many rows are on screen — which is not `visible.length`, because a run
   * arrives whole and brings parts the filters did not pass.
   */
  const shown = useMemo(
    () => items.reduce((n, item) => n + (item.kind === 'one' ? 1 : item.parts.length), 0),
    [items]
  );

  const open = playlists?.find((playlist) => playlist.id === params.playlistId) ?? null;
  /**
   * The rest of the open recording's run, in order — what the player's «next
   * part» reads. Taken from the whole shard rather than from `visible`, because
   * a filter that hides part two does not make part two stop existing, and the
   * player is past the point where the list's filters are the question.
   */
  const runOfOpen = useMemo(() => {
    if (!open?.series || !playlists) return [];
    const key = open.series.key;
    return playlists
      .filter((playlist) => playlist.series?.key === key)
      .sort((a, b) => (a.series?.pos ?? 0) - (b.series?.pos ?? 0));
  }, [open, playlists]);

  /**
   * A name pressed on a row is the same act as the tick in the strip above it,
   * so it writes the same state — see `toggleFacet`. Stable, because the rows
   * are memoised and a handler rebuilt on every filter change would re-render
   * every one of them.
   */
  const filterBy = useCallback((facet: FilterFacet, value: string) => {
    setFilters((state) => toggleFacet(state, facet, value));
  }, []);

  const row = (playlist: BuiltPlaylist) => {
    const label = labels.get(playlist.id) ?? {
      name: null,
      source: playlist.title,
      providerId: null,
      lecturer: null,
      detail: playlist.title,
    };
    return (
      <PlaylistRow
        key={playlist.id}
        playlist={playlist}
        label={label}
        language={languageLabel(playlist.lang, filters.langs)}
        providerFiltered={Boolean(
          label.providerId && facetActive(filters, 'provider', label.providerId)
        )}
        lecturerFiltered={Boolean(
          label.lecturer && facetActive(filters, 'lecturer', label.lecturer)
        )}
        showRetention={sort === 'retention'}
        onFilter={filterBy}
        onOpen={(id) => {
          lastFocused.current = document.activeElement as HTMLElement;
          params.setPlaylist(id);
        }}
      />
    );
  };

  if (!course.playlistCount) {
    return (
      <section className="border-t border-line px-4 py-4">
        <h3 className="text-sm font-medium">{t('ui.playlists.title')}</h3>
        <p className="mt-2 text-sm text-ink-faint">{t('ui.playlists.empty')}</p>
        <ButtonLink href={suggestPlaylistUrl(course.id)} className="mt-3">
          {t('ui.course.suggestPlaylist')}
        </ButtonLink>
      </section>
    );
  }

  return (
    <section className="border-t border-line px-4 py-4">
      <h3 className="mb-2 flex items-baseline gap-2 text-sm font-medium">
        {t('ui.playlists.title')}
        <span className="num text-xs text-ink-faint">
          {shown === (playlists?.length ?? 0)
            ? count(course.playlistCount, 'playlist')
            : `${shown} / ${playlists?.length ?? 0}`}
        </span>
      </h3>

      {playlists ? (
        <PlaylistFilters
          playlists={playlists}
          state={filters}
          onChange={setFilters}
          sort={sort}
          onSortChange={setSort}
          grouped={grouped}
          onGroupedChange={setGrouped}
          // Back to where this panel would have opened, which after an answer
          // is that answer — resetting to the page's language instead would
          // overwrite it, and the reader would have to give it again.
          onReset={() => setFilters(defaultFilters(lang, chosenLangs))}
        />
      ) : null}

      <div className="mt-2 space-y-0.5">
        {playlists === null ? (
          /* Skeletons rather than a «Загрузка…» line: the rows are a fixed
             height, so the list occupies its final size from the first frame
             and nothing under it jumps when the shard lands. */
          <RowSkeletons n={Math.min(course.playlistCount, 5)} />
        ) : items.length ? (
          <>
            {/* Above the rows, not instead of them: the sentence and the list
                it explains have to be read in that order. */}
            {otherLangs ? (
              <p className="pb-1 pt-1 text-center text-sm text-ink-faint">
                {t('ui.playlists.noneInLang', { lang: langLabel(filters.langs) })}
              </p>
            ) : null}
            {items.map((item) =>
              item.kind === 'one' ? (
                row(item.playlist)
              ) : (
                /* A run reads as one thing with parts, so it is drawn as one
                   thing: a rule down the left and a line saying that the rows
                   beside it are one course. Without it the list says nothing
                   about why «Часть 2» sits under «Часть 1» rather than being
                   ranked against it.

                   The heading stands outside the rule, and the padding is the
                   group's own rather than a margin the list's `space-y` can
                   override. Two runs an inch apart used to draw one unbroken
                   line down the page — which is the rule saying the opposite of
                   what it is there to say. Starting at the first part and
                   ending at the last is what makes it a bracket. */
                <div key={item.key} className="py-2">
                  <p className="num pb-0.5 pl-3 text-xs text-ink-faint">
                    {/* No count. The parts are right there to be counted, and
                        ours was a guess: it came off the highest number found
                        in the titles, so a run of «s3, s4» announced itself as
                        four parts and a course whose numbering we never
                        understood could say anything at all.

                        The hours are a different kind of number and are safe to
                        print: they are the sum of the rows drawn under this
                        line, not an estimate of somebody else's course. It is
                        the one figure the reader cannot get by looking — four
                        parts at «19.9 ч» each is a mental sum before you know
                        whether this is a term or two years — and it is what
                        makes a run comparable with the single recordings it is
                        ranked against.

                        Which is why the heading says «части одного курса»
                        rather than «один курс». A quarter of the runs in the
                        catalogue visibly start at part three, skip a part, or
                        carry one marked «фрагмент» — and the other three
                        quarters are not proved whole either, they are only runs
                        with no hole *we* can see. A fifth semester nobody
                        filmed leaves no trace at all. So the line claims what
                        it can carry — these rows belong to one course, and
                        together they run this long — and never that the course
                        ends where our rows do. */}
                    {t('ui.playlists.oneCourse')} ·{' '}
                    {t('ui.playlist.hours', { n: formatHours(hoursFromSeconds(runSeconds(item))) })}
                  </p>
                  <div className="border-l-2 border-line-strong pl-2">{item.parts.map(row)}</div>
                </div>
              )
            )}
          </>
        ) : (
          <p className="py-4 text-center text-sm text-ink-faint">
            {t('ui.playlists.emptyFiltered')}
          </p>
        )}
      </div>

      {open ? (
        <PlaylistModal
          playlist={open}
          courseId={course.id}
          run={runOfOpen}
          onOpenPart={(id) => params.setPlaylist(id)}
          filter={{
            active: (facet, value) => facetActive(filters, facet, value),
            toggle: filterBy,
          }}
          onClose={() => {
            params.setPlaylist(null);
            // Focus goes back to the row the modal was opened from.
            lastFocused.current?.focus?.();
          }}
        />
      ) : null}
    </section>
  );
}

/** The shape of a playlist row, at its exact height, while the shard loads. */
function RowSkeletons({ n }: { n: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: Math.max(1, n) }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-2 py-2">
          <span className="skeleton h-10 w-[70px] shrink-0 rounded" />
          <span className="min-w-0 flex-1">
            <span className="skeleton block h-3.5 w-2/3 rounded" />
            <span className="skeleton mt-1.5 block h-2.5 w-1/3 rounded" />
          </span>
          <span className="skeleton h-2 w-8 rounded" />
        </div>
      ))}
    </div>
  );
}

