import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BuiltPlaylist } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { loadPlaylistsCached } from '@/lib/data';
import { formatHours, hoursFromSeconds } from '@/lib/format';
import { courseHref, useCourseSlice } from '@/lib/url';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import Icon from '@/components/Icon';
import EmptyState from '@/components/EmptyState';
import { Chip } from '@/components/ui';

type GroupBy = 'course' | 'provider';

/**
 * Favourited playlists, always labelled with the course they belong to. Without
 * that link they hang in a vacuum, and a month later it is unclear why they are
 * saved at all.
 */
export default function PlaylistsTab() {
  const catalog = useCatalog();
  const { t } = useT();
  const navigate = useNavigate();
  const closeProfile = useUi((state) => state.closeProfile);
  const sliceAround = useCourseSlice();
  const favorites = useProfile((state) => state.profile.playlists);

  const [groupBy, setGroupBy] = useState<GroupBy>('course');
  const [loaded, setLoaded] = useState<BuiltPlaylist[]>([]);

  // The profile stores playlist ids only, so the owning course comes from the
  // search index — which already carries it for exactly this reason.
  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of catalog.search) {
      if (entry.t === 'p' && entry.c) map.set(entry.id, entry.c);
    }
    return map;
  }, [catalog.search]);

  const wantedIds = useMemo(
    () => Object.entries(favorites).filter(([, value]) => value.favorite).map(([id]) => id),
    [favorites]
  );

  useEffect(() => {
    const courseIds = new Set(
      wantedIds.map((id) => owners.get(id)).filter((id): id is string => Boolean(id))
    );
    let cancelled = false;
    Promise.all([...courseIds].map((courseId) => loadPlaylistsCached(courseId))).then((shards) => {
      if (cancelled) return;
      const wanted = new Set(wantedIds);
      setLoaded(shards.flat().filter((playlist) => wanted.has(playlist.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [wantedIds, owners]);

  const groups = useMemo(() => {
    const map = new Map<string, BuiltPlaylist[]>();
    for (const playlist of loaded) {
      const key = groupBy === 'course' ? playlist.courseId : playlist.providerId;
      map.set(key, [...(map.get(key) ?? []), playlist]);
    }
    return [...map.entries()];
  }, [loaded, groupBy]);

  if (!wantedIds.length) {
    return (
      <EmptyState
        icon="star"
        text={t('ui.profile.emptyPlaylists')}
        action={{ label: t('ui.profile.toMap'), onClick: () => { closeProfile(); navigate('/'); } }}
      />
    );
  }

  const openCourse = (courseId: string, playlistId?: string): void => {
    closeProfile();
    // The course's own fields come along, so the columns behind the playlist
    // are the field it belongs to rather than the entire catalogue.
    const query = new URLSearchParams(sliceAround(courseId));
    if (playlistId) query.set('playlist', playlistId);
    navigate(courseHref(courseId, query.toString() ? `?${query.toString()}` : ''));
  };

  return (
    <div className="p-4">
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
          <h3 className="mb-2 text-sm font-medium">
            {groupBy === 'course' ? (
              <button
                type="button"
                className="hover:text-accent"
                onClick={() => openCourse(key)}
              >
                {t(`course.${key}.title`)}
              </button>
            ) : (
              (catalog.providers[key]?.title ?? key)
            )}
          </h3>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() => openCourse(playlist.courseId, playlist.id)}
                className="surface overflow-hidden text-left hover:border-accent"
              >
                <span className="block aspect-video w-full bg-surface-2">
                  {playlist.videos[0]?.id ? (
                    <img
                      src={`https://i.ytimg.com/vi/${playlist.videos[0].id}/mqdefault.jpg`}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </span>
                <span className="block p-2">
                  <span className="line-clamp-2 text-xs text-ink">{playlist.title}</span>
                  <span className="num mt-1 block truncate text-[11px] text-ink-faint">
                    {catalog.providers[playlist.providerId]?.title ?? playlist.channelTitle} ·{' '}
                    {t('ui.playlist.hours', {
                      n: formatHours(hoursFromSeconds(playlist.totalSeconds)),
                    })}
                  </span>
                  {groupBy === 'provider' ? (
                    <span className="mt-1 block truncate text-[11px] text-accent">
                      {t(`course.${playlist.courseId}.title`)}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {loaded.length < wantedIds.length ? (
        <p className="flex items-center gap-2 text-xs text-ink-faint">
          <Icon name="warning" size={12} />
          {t('ui.common.loading')}
        </p>
      ) : null}
    </div>
  );
}
