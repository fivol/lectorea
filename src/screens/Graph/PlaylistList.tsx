import { useEffect, useMemo, useRef, useState } from 'react';
import type { BuiltCourse, BuiltPlaylist } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { loadPlaylistsCached } from '@/lib/data';
import { useCatalogParams } from '@/lib/url';
import { useProfile } from '@/store/profile';
import PlaylistFilters from './PlaylistFilters';
import PlaylistRow from './PlaylistRow';
import PlaylistModal from './PlaylistModal';
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

  const open = playlists?.find((playlist) => playlist.id === params.playlistId) ?? null;

  if (!course.playlistCount) {
    return (
      <section className="border-t border-line px-4 py-4">
        <h3 className="text-sm font-medium">{t('ui.playlists.title')}</h3>
        <p className="mt-2 text-sm text-ink-faint">{t('ui.playlists.empty')}</p>
        <a
          className="btn mt-3"
          href={suggestPlaylistUrl(course.id)}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t('ui.course.suggestPlaylist')}
        </a>
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
          <p className="py-4 text-center text-sm text-ink-faint">{t('ui.common.loading')}</p>
        ) : visible.length ? (
          visible.map((playlist) => (
            <PlaylistRow
              key={playlist.id}
              playlist={playlist}
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

export function suggestPlaylistUrl(courseId: string): string {
  const title = encodeURIComponent(`Плейлист для курса: ${courseId}`);
  const body = encodeURIComponent(
    [
      `Курс: \`${courseId}\``,
      '',
      'Ссылка на плейлист: ',
      'Вуз / канал: ',
      'Лектор: ',
      'Язык: ',
      '',
      'Почему стоит добавить: ',
    ].join('\n')
  );
  return `https://github.com/lectorea/lectorea/issues/new?title=${title}&body=${body}&labels=playlist`;
}

export function fixDataUrl(courseId: string): string {
  return `https://github.com/lectorea/lectorea/blob/main/data/courses.yaml#:~:text=${encodeURIComponent(
    `id: ${courseId}`
  )}`;
}
