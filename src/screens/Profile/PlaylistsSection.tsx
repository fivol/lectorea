import { useEffect, useMemo, useState } from 'react';
import type { BuiltPlaylist } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { loadPlaylistsCached } from '@/lib/data';
import { formatHours, hoursFromSeconds } from '@/lib/format';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import { Chip } from '@/components/ui';
import { useProfileNavigation } from './navigate';

type GroupBy = 'course' | 'provider';

/**
 * Saved playlists, always labelled with the course they belong to. Without that
 * link they hang in a vacuum, and a month later it is unclear why they are
 * saved at all.
 *
 * `limit` is what keeps the shelf from paying for the whole cupboard: the
 * titles live in the course shards, a shard runs to three quarters of a
 * megabyte, and the preview needs three of them. The rest are fetched when
 * somebody asks to see the rest.
 */
export function useFavoritePlaylists(limit?: number): {
  playlists: BuiltPlaylist[];
  total: number;
  pending: boolean;
} {
  const catalog = useCatalog();
  const favorites = useProfile((state) => state.profile.playlists);
  const [loaded, setLoaded] = useState<{ list: BuiltPlaylist[]; done: boolean }>({
    list: [],
    done: false,
  });

  // The profile stores playlist ids only, so the owning course comes from the
  // search index — which already carries it for exactly this reason.
  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of catalog.search) {
      if (entry.t === 'p' && entry.c) map.set(entry.id, entry.c);
    }
    return map;
  }, [catalog.search]);

  const all = useMemo(
    () =>
      Object.entries(favorites)
        .filter(([, value]) => value.favorite)
        .sort((a, b) => b[1].at.localeCompare(a[1].at))
        .map(([id]) => id),
    [favorites]
  );

  const wantedIds = useMemo(
    () => (limit === undefined ? all : all.slice(0, limit)),
    [all, limit]
  );

  useEffect(() => {
    const courseIds = new Set(
      wantedIds
        .map((id) => owners.get(id))
        .filter((id): id is string => Boolean(id))
    );
    let cancelled = false;
    setLoaded((previous) => (previous.done ? { ...previous, done: false } : previous));
    Promise.all([...courseIds].map((courseId) => loadPlaylistsCached(courseId))).then((shards) => {
      if (cancelled) return;
      const byId = new Map(shards.flat().map((playlist) => [playlist.id, playlist]));
      // Back into the order they were saved in: a shard hands its playlists
      // back sorted by rating, which is not what «мои плейлисты» means.
      const list: BuiltPlaylist[] = [];
      for (const id of wantedIds) {
        const playlist = byId.get(id);
        if (playlist) list.push(playlist);
      }
      setLoaded({ list, done: true });
    });
    return () => {
      cancelled = true;
    };
  }, [wantedIds, owners]);

  // `done` rather than a count: a saved playlist can drop out of the catalogue
  // between one crawl and the next, and «загрузка» that never finishes is worse
  // than one card fewer.
  return { playlists: loaded.list, total: all.length, pending: !loaded.done };
}

/**
 * The preview: the same playlists lying down.
 *
 * A poster is what you browse a shelf by, and three posters at the width of
 * this panel are half a screen of thumbnails in the middle of a summary. Lying
 * down they take a fifth of the height and still carry the frame, which is what
 * makes a saved playlist recognisable at all.
 */
export function PlaylistGrid({ playlists }: { playlists: BuiltPlaylist[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {playlists.map((playlist) => (
        <PlaylistCard key={playlist.id} playlist={playlist} withCourse compact />
      ))}
    </div>
  );
}

/**
 * The whole saved list, grouped the way the reader asks for.
 *
 * Grouping only exists here and not in the preview: three cards do not need to
 * be filed, and a control that changes nothing is a control that has to be
 * read anyway.
 */
export function PlaylistsExpanded() {
  const catalog = useCatalog();
  const { t } = useT();
  const { openCourse } = useProfileNavigation();
  const { playlists, pending } = useFavoritePlaylists();
  const [groupBy, setGroupBy] = useState<GroupBy>('course');

  const groups = useMemo(() => {
    const map = new Map<string, BuiltPlaylist[]>();
    for (const playlist of playlists) {
      const key = groupBy === 'course' ? playlist.courseId : playlist.providerId;
      map.set(key, [...(map.get(key) ?? []), playlist]);
    }
    return [...map.entries()];
  }, [playlists, groupBy]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-ink-faint">
        {t('ui.profile.groupBy')}:
        {(['course', 'provider'] as GroupBy[]).map((key) => (
          <Chip key={key} on={groupBy === key} onClick={() => setGroupBy(key)}>
            {t(`ui.profile.groupBy.${key}`)}
          </Chip>
        ))}
      </div>

      {groups.map(([key, list]) => (
        <section key={key} className="mb-6">
          <h4 className="mb-2 text-sm font-medium">
            {groupBy === 'course' ? (
              <button type="button" className="hover:text-accent" onClick={() => openCourse(key)}>
                {t(`course.${key}.title`)}
              </button>
            ) : (
              (catalog.providers[key]?.title ?? key)
            )}
          </h4>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((playlist) => (
              <PlaylistCard
                key={playlist.id}
                playlist={playlist}
                withCourse={groupBy === 'provider'}
              />
            ))}
          </div>
        </section>
      ))}

      {pending ? (
        <p className="flex items-center gap-2 text-xs text-ink-faint">
          <Icon name="warning" size={12} />
          {t('ui.common.loading')}
        </p>
      ) : null}
    </div>
  );
}

function PlaylistCard({
  playlist,
  withCourse,
  compact = false,
}: {
  playlist: BuiltPlaylist;
  withCourse: boolean;
  compact?: boolean;
}) {
  const catalog = useCatalog();
  const { t } = useT();
  const { openPlaylist } = useProfileNavigation();

  const frame = playlist.videos[0]?.id ? (
    <img
      src={`https://i.ytimg.com/vi/${playlist.videos[0].id}/mqdefault.jpg`}
      alt=""
      loading="lazy"
      className="h-full w-full object-cover"
    />
  ) : null;

  const caption = (
    <>
      <span className="line-clamp-2 text-xs text-ink">{playlist.title}</span>
      <span className="num mt-1 block truncate text-[11px] text-ink-faint">
        {catalog.providers[playlist.providerId]?.title ?? playlist.channelTitle} ·{' '}
        {t('ui.playlist.hours', {
          n: formatHours(hoursFromSeconds(playlist.totalSeconds)),
        })}
      </span>
      {withCourse ? (
        <span className="mt-0.5 block truncate text-[11px] text-accent">
          {t(`course.${playlist.courseId}.title`)}
        </span>
      ) : null}
    </>
  );

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => openPlaylist(playlist.courseId, playlist.id)}
        className="surface flex items-start gap-2.5 overflow-hidden p-2 text-left
                   hover:border-accent"
      >
        <span className="aspect-video w-20 shrink-0 overflow-hidden rounded bg-surface-2">
          {frame}
        </span>
        <span className="min-w-0 flex-1">{caption}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openPlaylist(playlist.courseId, playlist.id)}
      className="surface overflow-hidden text-left hover:border-accent"
    >
      <span className="block aspect-video w-full bg-surface-2">{frame}</span>
      <span className="block p-2">{caption}</span>
    </button>
  );
}
