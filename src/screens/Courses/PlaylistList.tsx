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
import { ButtonLink } from '@/components/ui';
import {
  applyFilters,
  defaultFilters,
  sortPlaylists,
  type PlaylistFilterState,
  type SortKey,
} from './playlist-filters';

type Props = { course: BuiltCourse };

export default function PlaylistList({ course }: Props) {
  const { t, count } = useT();
  const catalog = useCatalog();
  const profile = useProfile((state) => state.profile);
  const params = useCatalogParams();

  const [playlists, setPlaylists] = useState<BuiltPlaylist[] | null>(null);
  const [filters, setFilters] = useState<PlaylistFilterState>(defaultFilters([]));
  const [sort, setSort] = useState<SortKey>('score');
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlaylists(null);
    loadPlaylistsCached(course.id).then((loaded) => {
      if (cancelled) return;
      setPlaylists(loaded);
      setFilters(defaultFilters(loaded));
    });
    return () => {
      cancelled = true;
    };
  }, [course.id]);

  const visible = useMemo(() => {
    if (!playlists) return [];
    const filtered = applyFilters(
      playlists,
      filters,
      profile,
      { providers: params.providers, lecturers: params.lecturers },
      catalog.providers
    );
    return sortPlaylists(filtered, sort);
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
        lengthLabel: (playlist) => t(`ui.playlist.length.${playlist.lectureLength}`),
      }),
    [playlists, course.id, catalog.providers, t]
  );

  const open = playlists?.find((playlist) => playlist.id === params.playlistId) ?? null;

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
          onReset={() => setFilters(defaultFilters(playlists))}
        />
      ) : null}

      <div className="mt-2 space-y-0.5">
        {playlists === null ? (
          /* Skeletons rather than a «Загрузка…» line: the rows are a fixed
             height, so the list occupies its final size from the first frame
             and nothing under it jumps when the shard lands. */
          <RowSkeletons n={Math.min(course.playlistCount, 5)} />
        ) : visible.length ? (
          visible.map((playlist) => (
            <PlaylistRow
              key={playlist.id}
              playlist={playlist}
              label={labels.get(playlist.id) ?? { heading: playlist.title, detail: null }}
              onOpen={(id) => {
                lastFocused.current = document.activeElement as HTMLElement;
                params.setPlaylist(id);
              }}
            />
          ))
        ) : (
          <p className="py-4 text-center text-sm text-ink-faint">
            {t('ui.playlists.emptyFiltered')}
          </p>
        )}
      </div>

      {open ? (
        <PlaylistModal
          playlist={open}
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

