import { useCallback, useEffect, useState } from 'react';
import type { BuiltPlaylist } from '@shared/schema';
import { formatCompact, useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatDuration, formatHours, formatMinutes, hoursFromSeconds } from '@/lib/format';
import { useEscape, useFocusTrap, useIsMobile, useScrollLock } from '@/lib/hooks';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import Tooltip from '@/components/Tooltip';
import { QualityDot } from './PlaylistRow';

type Props = {
  playlist: BuiltPlaylist;
  onClose: () => void;
};

export default function PlaylistModal({ playlist, onClose }: Props) {
  const { t, count, lang } = useT();
  const catalog = useCatalog();
  const isMobile = useIsMobile();

  const watched = useProfile((state) => state.profile.playlists[playlist.id]?.watched ?? false);
  const favorite = useProfile((state) => state.profile.playlists[playlist.id]?.favorite ?? false);
  const toggleWatched = useProfile((state) => state.togglePlaylistWatched);
  const toggleFavorite = useProfile((state) => state.togglePlaylistFavorite);
  const recordRecent = useProfile((state) => state.recordRecent);

  /**
   * History is recorded here rather than at the click, so a pasted `?playlist=`
   * link counts too — opening is opening, however you got here.
   */
  useEffect(() => {
    recordRecent({ id: playlist.id, courseId: playlist.courseId, title: playlist.title });
  }, [playlist.id, playlist.courseId, playlist.title, recordRecent]);

  // The iframe is mounted only after an explicit click: YouTube pulls ~800 KB
  // per embed, and opening a modal to read the lecture list must not cost that.
  const [playing, setPlaying] = useState<string | null>(null);

  const close = useCallback(() => onClose(), [onClose]);
  useEscape(true, close);
  useScrollLock(true);
  const trapRef = useFocusTrap(true);

  useEffect(() => setPlaying(null), [playlist.id]);

  const provider = catalog.providers[playlist.providerId];
  const course = catalog.courseById.get(playlist.courseId);
  const poster = playlist.videos[0]?.id
    ? `https://i.ytimg.com/vi/${playlist.videos[0].id}/hqdefault.jpg`
    : null;

  const embedSrc = playing
    ? `https://www.youtube-nocookie.com/embed/${playing}?list=${playlist.id}&autoplay=1&rel=0`
    : `https://www.youtube-nocookie.com/embed/videoseries?list=${playlist.id}&autoplay=1&rel=0`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fade-only absolute inset-0 animate-fade-in bg-overlay backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />

      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={playlist.title}
        tabIndex={-1}
        className={`relative flex animate-scale-in flex-col overflow-hidden bg-surface
                    shadow-[var(--shadow-modal)]
                    ${isMobile ? 'h-full w-full' : 'max-h-[88vh] w-[min(1080px,92vw)] rounded-pop border border-line'}`}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {playlist.title}
            {provider ? <span className="text-ink-faint"> — {provider.title}</span> : null}
          </h2>
          <button
            type="button"
            className="btn-ghost rounded p-1.5"
            onClick={close}
            aria-label={t('ui.common.close')}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className={`flex min-h-0 flex-1 ${isMobile ? 'flex-col overflow-y-auto' : ''}`}>
          <div className="flex min-h-0 flex-1 flex-col">
            {/*
              `min-h-0` matters: as a flex item this box would otherwise take an
              automatic minimum from the poster image and squeeze the lecture
              list underneath it down to nothing.
            */}
            <div className="relative aspect-video max-h-[46vh] w-full min-h-0 shrink-0 bg-black">
              {playing === null ? (
                <button
                  type="button"
                  className="group relative h-full w-full"
                  onClick={() => setPlaying(playlist.videos[0]?.id ?? '')}
                  aria-label={t('ui.playlist.play')}
                >
                  {poster ? (
                    <img src={poster} alt="" className="h-full w-full object-cover opacity-70" />
                  ) : null}
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-canvas transition-transform group-hover:scale-105">
                      <Icon name="play" size={22} />
                    </span>
                    <span className="text-xs text-white/80">{t('ui.playlist.playHint')}</span>
                  </span>
                </button>
              ) : (
                <iframe
                  key={playing}
                  src={embedSrc}
                  title={playlist.title}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              )}
            </div>

            {/* The lecture list comes from the shard, not from the API. */}
            <ol
              className={`panel-scroll flex-1 divide-y divide-line ${
                isMobile ? 'min-h-0' : 'min-h-[140px] max-h-[38vh]'
              }`}
            >
              {playlist.videos.length ? (
                playlist.videos.map((video, index) => (
                  <li key={video.id}>
                    <button
                      type="button"
                      onClick={() => setPlaying(video.id)}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm
                                  transition-colors duration-fast ease-out hover:bg-surface-2
                                  ${playing === video.id ? 'bg-accent-soft text-ink' : 'text-ink-dim'}`}
                    >
                      <span className="num w-6 shrink-0 text-right text-xs text-ink-faint">
                        {index + 1}.
                      </span>
                      <span className="min-w-0 flex-1 truncate">{video.title}</span>
                      <span className="num shrink-0 text-xs text-ink-faint">
                        {formatDuration(video.seconds)}
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-4 py-6 text-center text-sm text-ink-faint">
                  {t('ui.common.loading')}
                </li>
              )}
            </ol>
          </div>

          <aside
            className={`panel-scroll shrink-0 border-line p-4 ${
              isMobile ? 'border-t' : 'w-[300px] border-l'
            }`}
          >
            <p className="text-sm font-medium text-ink">{playlist.lecturer ?? playlist.channelTitle}</p>
            <p className="num mt-1 text-xs text-ink-faint">
              {[provider?.title, playlist.year, playlist.lang].filter(Boolean).join(' · ')}
            </p>

            <dl className="num mt-4 space-y-1 text-xs text-ink-dim">
              <div className="flex justify-between">
                <dt>{count(playlist.videoCount, 'lecture')}</dt>
                <dd>{formatHours(hoursFromSeconds(playlist.totalSeconds))} ч</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('ui.playlist.avgLecture', { n: formatMinutes(playlist.medianSeconds) })}</dt>
                <dd>{t(`ui.playlist.length.${playlist.lectureLength}`)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t(`ui.playlist.completeness.${playlist.completeness}`)}</dt>
                <dd>{t(`ui.playlist.kind.${playlist.kind}`)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{t('ui.playlist.captions')}</dt>
                <dd>
                  {playlist.captions.length
                    ? playlist.captions.join(', ')
                    : t('ui.playlist.noCaptions')}
                </dd>
              </div>
            </dl>

            <div className="mt-4 space-y-1.5">
              <StatBar
                label={t('ui.playlist.views')}
                value={formatCompact(playlist.stats.views, lang)}
                fraction={1}
                hint={t('ui.playlist.relativeHint')}
              />
              <StatBar
                label={t('ui.playlist.likes')}
                value={formatCompact(playlist.stats.likes, lang)}
                fraction={playlist.stats.views ? playlist.stats.likes / playlist.stats.views * 12 : 0}
                hint={t('ui.playlist.relativeHint')}
              />
              <StatBar
                label={t('ui.playlist.comments')}
                value={formatCompact(playlist.stats.comments, lang)}
                fraction={
                  playlist.stats.views ? (playlist.stats.comments / playlist.stats.views) * 60 : 0
                }
                hint={t('ui.playlist.relativeHint')}
              />
              <div className="flex items-center justify-between pt-1 text-xs text-ink-faint">
                <span>{t('ui.playlist.score')}</span>
                <QualityDot playlist={playlist} />
              </div>
            </div>

            {course ? (
              <p className="mt-4 text-xs text-ink-faint">
                {t('ui.playlist.forCourse')}:{' '}
                <span className="text-ink-dim">{t(`course.${course.id}.title`)}</span>
              </p>
            ) : null}

            <div
              className={`mt-4 space-y-1.5 ${
                isMobile ? 'sticky bottom-0 bg-surface pb-2 pt-2' : ''
              }`}
            >
              <button
                type="button"
                className={`btn w-full justify-center ${favorite ? 'btn-primary' : ''}`}
                onClick={() => toggleFavorite(playlist.id)}
              >
                <Icon name={favorite ? 'star-filled' : 'star'} />
                {favorite ? t('ui.course.favoriteOn') : t('ui.course.favorite')}
              </button>
              <button
                type="button"
                className={`btn w-full justify-center ${watched ? 'btn-primary' : ''}`}
                onClick={() => toggleWatched(playlist.id)}
              >
                <Icon name="check" />
                {watched ? t('ui.playlist.watchedOn') : t('ui.playlist.watched')}
              </button>
              <a
                className="btn w-full justify-center"
                href={`https://www.youtube.com/playlist?list=${playlist.id}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                <Icon name="external" />
                {t('ui.playlist.openYoutube')}
              </a>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/**
 * A metric as a bar. The bar is a relative scale — likes and comments are
 * shown against what a playlist of this size usually gets, not against the raw
 * number — so it has to say so, or it reads as a percentage of something.
 */
function StatBar({
  label,
  value,
  fraction,
  hint,
}: {
  label: string;
  value: string;
  fraction: number;
  hint: string;
}) {
  const width = Math.max(4, Math.min(100, fraction * 100));
  return (
    <Tooltip content={hint}>
      <div className="flex cursor-help items-center gap-2">
        <span className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-surface-2">
          <span className="block h-full rounded-full bg-formal" style={{ width: `${width}%` }} />
        </span>
        <span className="flex-1 text-xs text-ink-faint">{label}</span>
        <span className="num text-xs text-ink-dim">{value}</span>
      </div>
    </Tooltip>
  );
}
