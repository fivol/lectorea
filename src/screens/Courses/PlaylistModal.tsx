import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { BuiltPlaylist, Video } from '@shared/schema';
import { formatCompact, useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatDuration, formatHours, formatMinutes, hoursFromSeconds } from '@/lib/format';
import { useEscape, useFocusTrap, useScrollLock } from '@/lib/hooks';
import { percent, playlistProgress } from '@/lib/progress';
import { courseHref, useCatalogParams } from '@/lib/url';
import { embedSrc, isResumable, useYouTubeTracking } from '@/lib/youtube';
import { useProfile, type WatchContext } from '@/store/profile';
import Icon from '@/components/Icon';
import ProgressBar from '@/components/ProgressBar';
import { Button, ButtonLink, IconButton } from '@/components/ui';
import Tooltip from '@/components/Tooltip';
import { StatusBadge } from './PlaylistRow';

type Props = {
  playlist: BuiltPlaylist;
  onClose: () => void;
};

/** What the player is showing, and where it was asked to start. */
type Playing = { id: string; start: number };

export default function PlaylistModal({ playlist, onClose }: Props) {
  const { t, lang } = useT();
  const catalog = useCatalog();
  const { search } = useCatalogParams();

  const profile = useProfile((state) => state.profile);
  const favorite = useProfile((state) => state.profile.playlists[playlist.id]?.favorite ?? false);
  const toggleWatched = useProfile((state) => state.togglePlaylistWatched);
  const toggleFavorite = useProfile((state) => state.togglePlaylistFavorite);
  const setVideosDone = useProfile((state) => state.setVideosDone);
  const recordPosition = useProfile((state) => state.recordPosition);
  const setCourseStatus = useProfile((state) => state.setCourseStatus);
  const recordRecent = useProfile((state) => state.recordRecent);

  const progress = playlistProgress(profile, playlist);

  /** What the store needs in order to know what a tick is part of. */
  const context: WatchContext = useMemo(
    () => ({
      courseId: playlist.courseId,
      playlistId: playlist.id,
      videoIds: playlist.videos.map((video) => video.id),
    }),
    [playlist]
  );

  /**
   * History is recorded here rather than at the click, so a pasted `?playlist=`
   * link counts too — opening is opening, however you got here.
   */
  useEffect(() => {
    recordRecent({ id: playlist.id, courseId: playlist.courseId, title: playlist.title });
  }, [playlist.id, playlist.courseId, playlist.title, recordRecent]);

  // The iframe is mounted only after an explicit click: YouTube pulls ~800 KB
  // per embed, and opening a modal to read the lecture list must not cost that.
  const [playing, setPlaying] = useState<Playing | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const close = useCallback(() => onClose(), [onClose]);
  useEscape(true, close);
  useScrollLock(true);
  const trapRef = useFocusTrap(true);

  useEffect(() => setPlaying(null), [playlist.id]);

  /**
   * Following the player.
   *
   * Both callbacks carry the whole context, because a lecture the player walked
   * on to by itself can finish the playlist, and finishing the playlist is what
   * finishes the course.
   */
  const { onLoad } = useYouTubeTracking({
    enabled: playing !== null,
    iframe: frame,
    onPosition: (videoId, sec) => recordPosition(videoId, sec, context),
    onWatched: (videoId) => setVideosDone([videoId], true, context),
  });

  /**
   * When the automation finishes the course, say so where it happened.
   *
   * A status that changes on its own behind a modal is a status nobody knows
   * they have. It is one line, it names the way out, and it goes away with the
   * dialog — the panel underneath is where the state actually lives.
   */
  const [promoted, setPromoted] = useState(false);
  const wasDone = useRef(profile.courses[playlist.courseId]?.status === 'done');
  useEffect(() => {
    const entry = profile.courses[playlist.courseId];
    const done = entry?.status === 'done';
    // And withdrawn the moment it stops being true: unticking a lecture puts
    // the course back to «изучается», and a line still announcing that it is
    // finished is worse than no line at all.
    if (!done) setPromoted(false);
    else if (!wasDone.current && !entry?.manual) setPromoted(true);
    wasDone.current = done;
  }, [profile.courses, playlist.courseId]);

  const provider = catalog.providers[playlist.providerId];
  const course = catalog.courseById.get(playlist.courseId);
  // The view behind the dialog, with the dialog itself taken out of it.
  const courseSearch = useMemo(() => {
    const query = new URLSearchParams(search);
    query.delete('playlist');
    const serialised = query.toString();
    return serialised ? `?${serialised}` : '';
  }, [search]);
  const poster = playlist.videos[0]?.id
    ? `https://i.ytimg.com/vi/${playlist.videos[0].id}/hqdefault.jpg`
    : null;

  /** Open a lecture, picking up where it was left unless it is already done. */
  const play = (video: Video): void => {
    const mark = profile.videos[video.id];
    const sec = !mark?.done && isResumable(mark?.sec) ? mark.sec : 0;
    setPlaying({ id: video.id, start: sec });
  };

  /** The poster plays the first lecture that is not behind you, not the first. */
  const playNext = (): void => {
    const next = progress.next;
    if (next) play(next.video);
    else if (playlist.videos[0]) play(playlist.videos[0]);
  };

  // Where the last tick was, so a shift-click has a range to work with.
  const anchor = useRef<number | null>(null);

  const tick = (index: number, next: boolean, extend: boolean): void => {
    const from = extend && anchor.current !== null ? anchor.current : index;
    const [start, end] = from <= index ? [from, index] : [index, from];
    const ids = playlist.videos.slice(start, end + 1).map((video) => video.id);
    setVideosDone(ids, next, context);
    anchor.current = index;
  };

  const setAll = (next: boolean): void => {
    if (next) toggleWatched(playlist.id, context);
    else setVideosDone(context.videoIds, false, context);
  };

  /*
   * Portalled, like every other layer that covers the window: on a phone this
   * opens from inside the course sheet, and a fixed box inside a transformed
   * ancestor is no longer fixed to the window but to the sheet — which crops it
   * to whatever part of the sheet is on screen.
   */
  return createPortal(
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
                  onClick={playNext}
                  aria-label={t('ui.playlist.play')}
                >
                  {poster ? (
                    <img src={poster} alt="" className="h-full w-full object-cover opacity-70" />
                  ) : null}
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-canvas transition-transform group-hover:scale-105">
                      <Icon name="play" size={22} />
                    </span>
                    {/* What the button will actually do. Half way through a
                        course it is «продолжить», and pressing something
                        labelled «смотреть» to be dropped at lecture nine is a
                        surprise even when it is the one you wanted. */}
                    <span className="text-xs text-white/80">
                      {progress.started && progress.next
                        ? t('ui.playlist.continueAt', { n: progress.next.index + 1 })
                        : t('ui.playlist.playHint')}
                    </span>
                  </span>
                </button>
              ) : (
                <iframe
                  ref={frame}
                  key={`${playing.id}:${playing.start}`}
                  src={embedSrc({
                    playlistId: playlist.id,
                    videoId: playing.id,
                    start: playing.start,
                  })}
                  title={playlist.title}
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  onLoad={onLoad}
                />
              )}
            </div>

            {/* The lecture list comes from the shard, not from the API. */}
            <ol className="divide-y divide-line lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
              {playlist.videos.length ? (
                playlist.videos.map((video, index) => (
                  <LectureRow
                    key={video.id}
                    video={video}
                    index={index}
                    playing={playing?.id === video.id}
                    sealed={progress.complete && !profile.videos[video.id]?.done}
                    onPlay={() => play(video)}
                    onTick={(next, extend) => tick(index, next, extend)}
                  />
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

              {/* Above the fact sheet, because it is the one thing here that is
                  about the reader rather than about the recording. Absent until
                  there is something to say: an empty bar over «0 из 30» repeats
                  the lecture count two lines below it. */}
              {progress.started ? (
                <div className="mt-4">
                  <ProgressBar
                    done={progress.done}
                    total={progress.total}
                    fill={progress.fraction}
                    label={`${percent(progress.fraction)}%`}
                  />
                  <p className="num mt-1 text-[11px] text-ink-faint">
                    {t('ui.playlist.watchedOf', {
                      done: progress.done,
                      total: progress.total,
                      hours: formatHours(hoursFromSeconds(progress.watchedSeconds)),
                      of: formatHours(hoursFromSeconds(progress.totalSeconds)),
                    })}
                  </p>
                </div>
              ) : null}

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
                {/* «Полнота: неизвестна» is a line about the catalogue, not
                    about the playlist: it costs a row and answers nothing. The
                    unknown ones drop out, and the sheet is what is known. */}
                {playlist.completeness === 'unknown' ? null : (
                  <Fact
                    label={t('ui.playlist.label.completeness')}
                    value={t(`ui.playlist.completeness.${playlist.completeness}`)}
                  />
                )}
                {playlist.kind === 'unknown' ? null : (
                  <Fact
                    label={t('ui.playlist.label.kind')}
                    value={t(`ui.playlist.kind.${playlist.kind}`)}
                  />
                )}
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
                {/* The share of the audience still there at the end — the one
                    number here that is about the course rather than its size. */}
                {playlist.retention !== undefined && playlist.curve !== 'assorted' ? (
                  <StatBar
                    label={t('ui.playlist.retention')}
                    value={`${Math.round(playlist.retention * 100)}%`}
                    fraction={playlist.retention}
                    hint={t('ui.playlist.retentionValue', {
                      percent: `${Math.round(playlist.retention * 100)}%`,
                    })}
                  />
                ) : null}
                <div className="flex items-center justify-between gap-3 pt-1 text-xs text-ink-faint">
                  <span>{t('ui.playlist.statusHow')}</span>
                  <StatusBadge playlist={playlist} />
                </div>
              </div>

              {/* The course is a link, not a caption: it is the one name in the
                  dialog that leads somewhere, and the press means "put the
                  panel back" — so it goes to the course with the playlist
                  dropped from the query, which is exactly what closing does.
                  `replace`, like the opening did, so the way back out of the
                  dialog is still one press. */}
              {course ? (
                <p className="mt-4 text-xs text-ink-faint">
                  {t('ui.playlist.forCourse')}:{' '}
                  <Link
                    to={courseHref(course.id, courseSearch)}
                    replace
                    className="rounded text-ink-dim underline decoration-line underline-offset-2
                               transition-colors duration-fast ease-out
                               hover:text-accent hover:decoration-accent"
                  >
                    {t(`course.${course.id}.title`)}
                  </Link>
                </p>
              ) : null}
            </div>

            {/* Pinned to the bottom of whichever box scrolls — the dialog on a
                phone, the sidebar itself once it is a column. */}
            <div className="sticky bottom-0 mt-auto space-y-1.5 border-t border-line bg-surface p-4">
              {promoted && course ? (
                <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-accent">
                  <Icon name="check" size={12} />
                  {t('ui.playlist.coursePromoted')}
                  <button
                    type="button"
                    className="underline decoration-line underline-offset-2 hover:text-ink"
                    onClick={() => {
                      setCourseStatus(course.id, 'in_progress');
                      setPromoted(false);
                    }}
                  >
                    {t('ui.common.undo')}
                  </button>
                </p>
              ) : null}
              <Button
                variant={favorite ? 'primary' : 'default'}
                icon={favorite ? 'star-filled' : 'star'}
                iconSize={16}
                className="w-full justify-center"
                onClick={() => toggleFavorite(playlist.id)}
              >
                {favorite ? t('ui.course.favoriteOn') : t('ui.course.favorite')}
              </Button>
              {/* The label names what the press does. Half way through, that is
                  «отметить все 30» — not «просмотрено», which is a claim about
                  a state the row of ticks above already contradicts. */}
              <Button
                variant={progress.complete ? 'primary' : 'default'}
                icon="check"
                iconSize={16}
                className="w-full justify-center"
                onClick={() => setAll(!progress.complete)}
              >
                {progress.complete
                  ? t('ui.playlist.watchedOn')
                  : progress.started
                    ? t('ui.playlist.watchedAll', { n: progress.total })
                    : t('ui.playlist.watched')}
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
    </div>,
    document.body
  );
}

/**
 * One lecture: a tick, a name that plays, and how long it runs.
 *
 * The tick is its own control rather than part of the row, and it has to be —
 * a checkbox inside a button is not something HTML allows, and the two answer
 * different questions anyway. «I watched this on YouTube» is the reason the
 * tick exists at all: without it, everything watched outside this player is
 * invisible to the site, which makes the progress it shows a lie of omission.
 *
 * Shift extends from the last one ticked, because the person who comes to this
 * list having watched twelve of thirty elsewhere should not have to press
 * twelve times.
 */
function LectureRow({
  video,
  index,
  playing,
  sealed,
  onPlay,
  onTick,
}: {
  video: Video;
  index: number;
  playing: boolean;
  /** Counted watched by the playlist's seal rather than by a tick of its own. */
  sealed: boolean;
  onPlay: () => void;
  onTick: (next: boolean, extend: boolean) => void;
}) {
  const { t } = useT();
  const mark = useProfile((state) => state.profile.videos[video.id]);
  const done = sealed || (mark?.done ?? false);
  const left = !done && isResumable(mark?.sec) ? mark.sec : 0;

  return (
    <li className={`relative flex items-center ${playing ? 'bg-accent-soft' : ''}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`${t('ui.playlist.markWatched')}: ${video.title}`}
        onClick={(event) => onTick(!done, event.shiftKey)}
        className="flex h-11 w-10 shrink-0 items-center justify-center text-ink-faint
                   transition-colors duration-fast ease-out hover:text-ink"
      >
        <span
          className={`flex h-[18px] w-[18px] items-center justify-center rounded border
                      transition-colors duration-fast ease-out
                      ${done ? 'border-accent bg-accent text-canvas' : 'border-line-strong'}`}
        >
          {done ? <Icon name="check" size={12} /> : null}
        </span>
      </button>

      <button
        type="button"
        onClick={onPlay}
        className={`flex min-w-0 flex-1 items-center gap-3 py-2 pr-4 text-left text-sm
                    transition-colors duration-fast ease-out hover:bg-surface-2
                    ${playing ? 'text-ink' : done ? 'text-ink-faint' : 'text-ink-dim'}`}
      >
        <span className="num w-4 shrink-0 text-right text-xs text-ink-faint">{index + 1}.</span>
        <span className="min-w-0 flex-1 truncate">{video.title}</span>
        {/* Where you stopped, in place of the length — the length of a lecture
            you are part way through is the less useful of the two. */}
        <span className={`num shrink-0 text-xs ${left ? 'text-accent' : 'text-ink-faint'}`}>
          {left ? formatDuration(left) : formatDuration(video.seconds)}
        </span>
      </button>

      {left ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-transparent">
          <span
            className="block h-full bg-accent/60"
            style={{ width: `${Math.min(100, (left / Math.max(1, video.seconds)) * 100)}%` }}
          />
        </span>
      ) : null}
    </li>
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
