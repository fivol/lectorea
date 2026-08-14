import { useEffect, useMemo, useRef, useState } from 'react';
import type { BuiltCourse, BuiltPlaylist } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { loadPlaylistsCached } from '@/lib/data';
import { suggestPlaylistUrl } from '@/lib/repo';
import { useCatalogParams } from '@/lib/url';
import { useProfile } from '@/store/profile';
import PlaylistFilters from './PlaylistFilters';
import PlaylistRow from './PlaylistRow';
import PlaylistModal from './PlaylistModal';
import { playlistHeadings } from './playlist-label';
import { groupRuns } from './series';
import { ButtonLink } from '@/components/ui';
import {
  applyFilters,
  defaultFilters,
  langLabel,
  languageLabel,
  sortPlaylists,
  type PlaylistFilterState,
  type SortKey,
} from './playlist-filters';

type Props = { course: BuiltCourse };

export default function PlaylistList({ course }: Props) {
  const { t, count, lang } = useT();
  const catalog = useCatalog();
  const profile = useProfile((state) => state.profile);
  const params = useCatalogParams();

  const [playlists, setPlaylists] = useState<BuiltPlaylist[] | null>(null);
  const [filters, setFilters] = useState<PlaylistFilterState>(() => defaultFilters(lang));
  const [sort, setSort] = useState<SortKey>('rating');
  const lastFocused = useRef<HTMLElement | null>(null);

  // The interface language is the starting point, not a leash: opening another
  // course starts from it again, but switching the header toggle leaves an open
  // panel's filters alone — they are the user's, and the chip says which.
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    let cancelled = false;
    setPlaylists(null);
    setFilters(defaultFilters(langRef.current));
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

  /** The list as it is drawn: single recordings, and runs kept together. */
  const items = useMemo(() => groupRuns(visible), [visible]);

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

  const row = (playlist: BuiltPlaylist) => (
    <PlaylistRow
      key={playlist.id}
      playlist={playlist}
      label={
        labels.get(playlist.id) ?? {
          name: null,
          source: playlist.title,
          detail: playlist.title,
        }
      }
      language={languageLabel(playlist.lang, filters.langs)}
      showRetention={sort === 'retention'}
      onOpen={(id) => {
        lastFocused.current = document.activeElement as HTMLElement;
        params.setPlaylist(id);
      }}
    />
  );

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
          {visible.length === (playlists?.length ?? 0)
            ? count(course.playlistCount, 'playlist')
            : `${visible.length} / ${playlists?.length ?? 0}`}
        </span>
      </h3>

      {playlists ? (
        <PlaylistFilters
          playlists={playlists}
          state={filters}
          onChange={setFilters}
          sort={sort}
          onSortChange={setSort}
          onReset={() => setFilters(defaultFilters(lang))}
        />
      ) : null}

      <div className="mt-2 space-y-0.5">
        {playlists === null ? (
          /* Skeletons rather than a «Загрузка…» line: the rows are a fixed
             height, so the list occupies its final size from the first frame
             and nothing under it jumps when the shard lands. */
          <RowSkeletons n={Math.min(course.playlistCount, 5)} />
        ) : visible.length ? (
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
                   thing: a rule down the left and a line saying how many parts
                   there are. Without it the list says nothing about why «Часть
                   2» sits under «Часть 1» rather than being ranked against it. */
                <div key={item.key} className="my-1 border-l-2 border-line-strong pl-2">
                  <p className="px-1 pb-0.5 text-xs text-ink-faint">
                    {/* How many parts the run has, not how many of them we
                        hold: a course of four semesters is a course of four
                        semesters whether or not the third was ever uploaded. */}
                    {t('ui.playlists.oneCourseIn', {
                      n: count(item.parts[0]?.series?.total ?? item.parts.length, 'part'),
                    })}
                  </p>
                  {item.parts.map(row)}
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

