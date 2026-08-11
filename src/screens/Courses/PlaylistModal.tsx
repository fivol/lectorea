import { useCallback, useEffect, useState } from 'react';
import type { BuiltPlaylist } from '@shared/schema';
import { formatCompact, useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatDuration, formatHours, formatMinutes, hoursFromSeconds } from '@/lib/format';
import { useEscape, useFocusTrap, useScrollLock } from '@/lib/hooks';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import { Button, ButtonLink, IconButton } from '@/components/ui';
import Tooltip from '@/components/Tooltip';
import { QualityDot } from './PlaylistRow';

type Props = {
  playlist: BuiltPlaylist;
  onClose: () => void;
};

export default function PlaylistModal({ playlist, onClose }: Props) {
  const { t, lang } = useT();
  const catalog = useCatalog();

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

      {/*
        A sheet that fills the phone and a dialog that floats on everything
        else. The switch is a media query rather than a measured viewport,
        because the layout is the browser's job and doing it in JavaScript costs
        a first frame in the wrong shape on every open.
      */}
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={playlist.title}
        tabIndex={-1}
        className="relative flex h-full w-full animate-scale-in flex-col overflow-hidden
                   bg-surface shadow-[var(--shadow-modal)]
                   md:h-auto md:max-h-[88svh] md:w-[min(64rem,92vw)] md:rounded-pop
                   md:border md:border-line"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          {/* Two lines rather than one: these titles carry the term and the
              lecturer at the end, and a single truncated line drops both. */}
          <h2 className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-snug">
            {playlist.title}
            {provider ? <span className="text-ink-faint"> — {provider.title}</span> : null}
          </h2>
          <IconButton icon="close" label={t('ui.common.close')} onClick={close} />
        </header>

        {/*
          One scroll region until there is room for two columns, then the player
          and the sidebar scroll on their own. `minmax(0,1fr)` is what lets the
          lecture titles truncate: an `auto` track takes its width from the
          longest title and pushes the sidebar off the dialog.
        */}
        <div
          className="grid min-h-0 flex-1 overflow-y-auto overscroll-contain
                     lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)] lg:overflow-hidden"
        >
          <div className="flex min-w-0 flex-col lg:min-h-0">
            {/*
              A ratio box with nothing in flow inside it: the poster is 480×360
              and in flow it hands the box a content-based minimum height of its
              own, which stretches the player past 16:9 and shoves the lecture
              list off the screen. Out of flow, the height is the ratio and
              nothing else — capped against the viewport so the list always
              keeps about half the dialog.
            */}
            <div className="relative aspect-video w-full shrink-0 bg-black lg:max-h-[42svh]">
              {playing === null ? (
                <button
                  type="button"
                  className="group absolute inset-0"
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
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              )}
            </div>

            {/* The lecture list comes from the shard, not from the API. */}
            <ol className="divide-y divide-line lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
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
            className="flex min-w-0 flex-col border-t border-line
                       lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-l lg:border-t-0"
          >
            <div className="min-w-0 p-4">
              <p className="text-sm font-medium text-ink">
                {playlist.lecturer ?? playlist.channelTitle}
              </p>
              <p className="num mt-1 text-xs text-ink-faint">
                {[provider?.title, playlist.year, playlist.lang].filter(Boolean).join(' · ')}
              </p>

              <dl className="num mt-4 space-y-1 text-xs">
                <Fact
                  label={t('ui.playlist.label.lectures')}
                  value={String(playlist.videoCount)}
                />
                <Fact
                  label={t('ui.playlist.label.total')}
                  value={t('ui.playlist.hours', {
                    n: formatHours(hoursFromSeconds(playlist.totalSeconds)),
                  })}
                />
                <Fact
                  label={t('ui.playlist.label.avg')}
                  value={`${t('ui.playlist.avgLecture', {
                    n: formatMinutes(playlist.medianSeconds),
                  })} · ${t(`ui.playlist.length.${playlist.lectureLength}`)}`}
                />
                <Fact
                  label={t('ui.playlist.label.completeness')}
                  value={t(`ui.playlist.completeness.${playlist.completeness}`)}
                />
                <Fact
                  label={t('ui.playlist.label.kind')}
                  value={t(`ui.playlist.kind.${playlist.kind}`)}
                />
                <Fact
                  label={t('ui.playlist.label.captions')}
                  value={
                    playlist.captions.length
                      ? playlist.captions.join(', ')
                      : t('ui.playlist.noCaptions')
                  }
                />
              </dl>

              <div className="mt-4 space-y-2">
                <StatBar
                  label={t('ui.playlist.views')}
                  value={formatCompact(playlist.stats.views, lang)}
                  fraction={1}
                  hint={t('ui.playlist.relativeHint')}
                />
                <StatBar
                  label={t('ui.playlist.likes')}
                  value={formatCompact(playlist.stats.likes, lang)}
                  fraction={
                    playlist.stats.views ? (playlist.stats.likes / playlist.stats.views) * 12 : 0
                  }
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
                <div className="flex items-center justify-between gap-3 pt-1 text-xs text-ink-faint">
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
            </div>

            {/* Pinned to the bottom of whichever box scrolls — the dialog on a
                phone, the sidebar itself once it is a column. */}
            <div className="sticky bottom-0 mt-auto space-y-1.5 border-t border-line bg-surface p-4">
              <Button
                variant={favorite ? 'primary' : 'default'}
                icon={favorite ? 'star-filled' : 'star'}
                iconSize={16}
                className="w-full justify-center"
                onClick={() => toggleFavorite(playlist.id)}
              >
                {favorite ? t('ui.course.favoriteOn') : t('ui.course.favorite')}
              </Button>
              <Button
                variant={watched ? 'primary' : 'default'}
                icon="check"
                iconSize={16}
                className="w-full justify-center"
                onClick={() => toggleWatched(playlist.id)}
              >
                {watched ? t('ui.playlist.watchedOn') : t('ui.playlist.watched')}
              </Button>
              <ButtonLink
                href={`https://www.youtube.com/playlist?list=${playlist.id}`}
                icon="external"
                iconSize={16}
                className="w-full justify-center"
              >
                {t('ui.playlist.openYoutube')}
              </ButtonLink>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** One line of the fact sheet. The value wraps rather than truncates — every
 *  one of them is short, and a clipped «без субтитров» says the opposite. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-right text-ink-dim">{value}</dd>
    </div>
  );
}

/**
 * A metric as a bar. The bar is a relative scale — likes and comments are
 * shown against what a playlist of this size usually gets, not against the raw
 * number — so it has to say so, or it reads as a percentage of something.
 *
 * Name and number sit on their own line above the bar: side by side they need
 * three fixed widths to stay aligned, and the sidebar is not a fixed width.
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
      <div className="cursor-help">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="min-w-0 truncate text-ink-faint">{label}</span>
          <span className="num shrink-0 text-ink-dim">{value}</span>
        </div>
        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-2">
          <span className="block h-full rounded-full bg-formal" style={{ width: `${width}%` }} />
        </span>
      </div>
    </Tooltip>
  );
}
