import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  measuredRetention,
  playlistTypeOf,
  type BuiltPlaylist,
  type Video,
} from '@shared/schema';
import { formatCompact, useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatHours, formatMinutes, hoursFromSeconds } from '@/lib/format';
import { useEscape, useFocusTrap, useScrollLock } from '@/lib/hooks';
import { percent, playlistProgress } from '@/lib/progress';
import { courseHref, useCatalogParams } from '@/lib/url';
import { embedSrc, isResumable, useYouTubePlayer, watchUrl } from '@/lib/youtube';
import { useProfile, type WatchContext } from '@/store/profile';
import { useUi } from '@/store/ui';
import Icon from '@/components/Icon';
import ProgressBar from '@/components/ProgressBar';
import { FactTile, FactTiles, Meter } from '@/components/Facts';
import AudienceLine from '@/components/game/Audience';
import FinishCard from '@/components/game/FinishCard';
import MilestoneLine from '@/components/game/Milestone';
import TodayLine from '@/components/game/TodayLine';
import WeekPlan from '@/components/game/WeekPlan';
import { Button, ButtonLink, Chip, IconButton, cx } from '@/components/ui';
import LectureList from './LectureList';
import NowPlaying from './NowPlaying';
import PlayerSpeed from './PlayerSpeed';
import { FilterName, StatusBadge } from './PlaylistRow';
import type { FilterFacet } from './playlist-filters';
import { neighbours, partLabel } from './series';

type Props = {
  playlist: BuiltPlaylist;
  /** Whose shard this was opened from — the one course not worth naming again. */
  courseId?: string;
  /** The whole run this recording is a part of, in order. Empty when it is not. */
  run?: BuiltPlaylist[];
  onOpenPart?: (id: string) => void;
  /**
   * The university and the lecturer as questions rather than captions, the same
   * as on the rows. Pressing one closes the player: the answer is the list
   * behind it, and leaving the player open over the list hides what was asked
   * for. Absent where the player has no list under it.
   */
  filter?: {
    active: (facet: FilterFacet, value: string) => boolean;
    toggle: (facet: FilterFacet, value: string) => void;
  };
  onClose: () => void;
};

/** What the player is showing, and where it was asked to start. */
type Playing = { id: string; start: number };

/**
 * Two shapes of one dialog.
 *
 * `list` is the sheet about a recording: a small frame, the lectures under it,
 * and everything the catalogue knows about it beside them — what somebody
 * reads while deciding whether to take this recording on.
 *
 * `watch` is the screen it is studied on: the frame takes the room, the
 * lectures become a queue beside it, and what is playing gets said in words
 * under the picture. The fact sheet is still there, under the queue, because a
 * question about the recording does not stop being asked once it is running.
 */
export type PlayerView = 'list' | 'watch';

export default function PlaylistModal({
  playlist,
  courseId,
  run = [],
  onOpenPart,
  filter,
  onClose,
}: Props) {
  const { t, count, lang } = useT();
  const { prev, next } = neighbours(playlist, run);
  /** Courses this recording also teaches, minus the one we are reading it in. */
  const alsoCovers = [playlist.courseId, ...playlist.alsoCourses].filter((id) => id !== courseId);
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
  const setSetting = useProfile((state) => state.setSetting);
  const savedRate = useProfile((state) => state.profile.settings.playbackRate);

  const progress = playlistProgress(profile, playlist);
  /** Null for a shelf entered from search, whose ratio is not about staying. */
  const retention = measuredRetention(playlist);

  /** What the store needs in order to know what a tick is part of, and what it is worth. */
  const context: WatchContext = useMemo(
    () => ({
      courseId: playlist.courseId,
      playlistId: playlist.id,
      videos: playlist.videos.map((video) => ({ id: video.id, seconds: video.seconds })),
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
  /**
   * Which lecture is actually in the frame, and where its playhead is.
   *
   * Kept apart from `playing`, which is what the frame was *asked* to load and
   * is therefore the iframe's key: writing the lecture YouTube walked on to
   * into that state would rebuild the frame and start the lecture again from
   * the top. Everything the reader is shown — the row lit in the queue, the
   * title under the picture, which lecture the tick marks off — follows this
   * one instead, so it stays true through an autoplay the app never ordered.
   */
  const [at, setAt] = useState<{ id: string; sec: number } | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  /** Which of the two shapes the dialog is in — see `PlayerView`. */
  const [view, setView] = useState<PlayerView>('list');
  const watching = view === 'watch';

  const close = useCallback(() => onClose(), [onClose]);
  useEscape(true, close);
  useScrollLock(true);
  const trapRef = useFocusTrap(true);

  useEffect(() => {
    setPlaying(null);
    setAt(null);
  }, [playlist.id]);

  /**
   * While a lecture runs, the keyboard is the player's.
   *
   * The app's single letters are safe on a page being read and not on one being
   * watched: `m` swaps map and columns, which closes the player mid-lecture,
   * and it sits one key away from the `k` and `l` the player answers.
   */
  const holdKeyboard = useUi((state) => state.holdKeyboard);
  useEffect(() => {
    if (playing === null) return;
    return holdKeyboard();
  }, [playing, holdKeyboard]);

  /**
   * The playlist to hand the player, or nothing.
   *
   * A few perfectly public playlists are met with «This video is unavailable»
   * the moment their id is passed as `list=`, while every lecture in them plays
   * on its own — so those are given to the frame one lecture at a time. The
   * course is not diminished by it: the order is ours, out of the shard.
   */
  const listId = playlist.listPlayable ? playlist.id : null;

  /**
   * Following the player.
   *
   * Both callbacks carry the whole context, because a lecture the player walked
   * on to by itself can finish the playlist, and finishing the playlist is what
   * finishes the course.
   */
  const { onLoad, rate, rates, setRate } = useYouTubePlayer({
    enabled: playing !== null,
    iframe: frame,
    // Where the keyboard goes back to when a click hands it to YouTube: the
    // dialog itself, which is where it was when the player opened.
    home: trapRef,
    // The speed is the reader's, not the lecture's: it is picked once and
    // every frame after it — the next part, the dialog reopened — starts there.
    rate: savedRate,
    onRate: (next) => setSetting('playbackRate', next),
    onPosition: (videoId, sec, played) => {
      // The screen's own copy of where the playhead is. It cannot be read back
      // out of the profile: «Место остановки» switches the stored position off,
      // and somebody who asked not to be *remembered* has not asked to stop
      // being *shown* how far into the lecture they are.
      setAt({ id: videoId, sec });
      recordPosition(videoId, sec, context, played);
    },
    // «player», so the day is not charged for the lecture's whole length on top
    // of the time the frame has already reported watching it.
    onWatched: (videoId) => setVideosDone([videoId], true, context, 'player'),
    // Without `list=` there is no rail behind the frame to walk along, so the
    // walking is done here. With one, YouTube is already doing it and a second
    // mover would fight it.
    onEnded: listId
      ? undefined
      : (videoId) => {
          const index = playlist.videos.findIndex((video) => video.id === videoId);
          const next = index === -1 ? undefined : playlist.videos[index + 1];
          if (next) play(next);
        },
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

  /*
   * The two names in the corner of the player that the list can be asked about.
   *
   * The university only counts as one where it is a university: «Прочие каналы»
   * is the provider of last resort and stands in for a hundred channels, so a
   * filter built from it answers a question nobody asked — the same rule the
   * rows follow, and for the same reason. The lecturer is whoever the build
   * worked out; where it worked out nobody, the line falls back to the channel
   * and stays a caption.
   */
  const named = (facet: FilterFacet, value: string | null | undefined, label = value) =>
    filter && value && label
      ? {
          name: label,
          on: filter.active(facet, value),
          press: () => {
            filter.toggle(facet, value);
            onClose();
          },
        }
      : null;
  const lecturerFilter = named('lecturer', playlist.lecturer);
  const providerFilter = named(
    'provider',
    provider && playlist.providerId !== 'unknown' ? playlist.providerId : null,
    provider?.title
  );
  const rest = [playlist.year, playlist.lang].filter(Boolean).join(' · ');
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

  /**
   * Open a lecture, picking up where it was left unless it is already done.
   *
   * Playing is what puts the dialog into the watching shape. Nothing else does
   * — a lecture YouTube walks on to by itself leaves the view alone, and so
   * does the reader who went back to the fact sheet with the lecture running.
   */
  const play = (video: Video): void => {
    const mark = profile.videos[video.id];
    const sec = !mark?.done && isResumable(mark?.sec) ? mark.sec : 0;
    setPlaying({ id: video.id, start: sec });
    setAt({ id: video.id, sec });
    setView('watch');
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
    else setVideosDone(context.videos.map((video) => video.id), false, context);
  };

  /*
   * The lecture on screen, and the two beside it.
   *
   * `at` first and `playing` only as the opening frame's stand-in: what the
   * reader is looking at is whatever the player last named, which after an
   * autoplay is not what the app asked for. A lecture the shard does not carry
   * — a private entry YouTube walked into — is simply not one of these rows,
   * and the strip under the frame stands down rather than naming it wrongly.
   */
  const shownId = at?.id ?? playing?.id ?? null;
  const shownIndex = shownId ? playlist.videos.findIndex((video) => video.id === shownId) : -1;
  const shown = shownIndex === -1 ? null : playlist.videos[shownIndex];
  const shownDone = shown ? progress.complete || (profile.videos[shown.id]?.done ?? false) : false;
  const step = (delta: number) => {
    const video = playlist.videos[shownIndex + delta];
    return video ? () => play(video) : null;
  };

  /*
   * Where this sits in the run, and the way out of it in either direction. A
   * course cut in half is the one case where the next thing to watch is not a
   * matter of taste, and the player is where that question is asked.
   *
   * Written once and stood in one of two places: on the fact sheet while a
   * recording is being read about, and directly over the queue while it is
   * being watched — where the reader who has just run out of lectures is
   * looking, rather than a hundred rows below them.
   */
  const seriesNav =
    playlist.series && run.length > 1 ? (
      <div className="mt-3 rounded-card border border-line px-3 py-2">
        {/* Which part this is, and nothing about how many there are: that
            number was the highest one we could find in the titles, which is a
            claim about a university's numbering and not something the
            catalogue can know. The buttons below say what actually exists. */}
        <p className="text-xs text-ink-faint">{partLabel(playlist.series, t)}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {prev ? (
            <Button
              variant="default"
              icon="chevron-left"
              iconSize={14}
              onClick={() => onOpenPart?.(prev.id)}
            >
              {prev.series ? partLabel(prev.series, t) : t('ui.playlist.prevPart')}
            </Button>
          ) : null}
          {next ? (
            <Button
              variant="primary"
              icon="chevron-right"
              iconSize={14}
              onClick={() => onOpenPart?.(next.id)}
            >
              {next.series ? partLabel(next.series, t) : t('ui.playlist.nextPart')}
            </Button>
          ) : null}
        </div>
      </div>
    ) : null;

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

        Watching takes the room it can get, and takes it as a stated height
        rather than a ceiling: the frame is what grows into whatever is left
        over, and `max-h` on a box that sizes itself to its content gives it
        nothing to grow into.
      */}
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={playlist.title}
        tabIndex={-1}
        className={cx(
          `relative flex h-full w-full animate-scale-in flex-col overflow-hidden
           bg-surface shadow-[var(--shadow-modal)] md:rounded-pop md:border md:border-line`,
          watching
            ? 'md:h-[92svh] md:w-[min(100rem,96vw)]'
            : 'md:h-auto md:max-h-[88svh] md:w-[min(64rem,92vw)]'
        )}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          {/* Two lines rather than one: these titles carry the term and the
              lecturer at the end, and a single truncated line drops both. */}
          <h2 className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-snug">
            {playlist.title}
            {provider ? <span className="text-ink-faint"> — {provider.title}</span> : null}
          </h2>
          {/* The way between the two shapes, and the way back the watching one
              needs. A glyph rather than a word because it sits beside the ×
              on a phone header that is already carrying a two-line title —
              and it is the glyph every player wears for the same act. */}
          <IconButton
            icon={watching ? 'collapse' : 'fit'}
            label={watching ? t('ui.player.toList') : t('ui.player.theatre')}
            aria-pressed={watching}
            onClick={() => setView(watching ? 'list' : 'watch')}
          />
          <IconButton icon="close" label={t('ui.common.close')} onClick={close} />
        </header>

        {/*
          One scroll region until there is room for two columns, then the player
          and the sidebar scroll on their own. `minmax(0,1fr)` is what lets the
          lecture titles truncate: an `auto` track takes its width from the
          longest title and pushes the sidebar off the dialog.

          Watching is the one shape that does not scroll as a whole even on a
          phone: the frame stays put at the top and the queue under it scrolls,
          which is what a screen somebody spends an hour on has to do.
        */}
        <div
          className={cx(
            'min-h-0 flex-1 lg:overflow-hidden',
            watching
              ? // A stated width rather than a share: the queue is a column of
                // numbered titles and a length, and every pixel past what those
                // need comes out of the picture. It is the picture the reader is
                // here for, so it takes everything the dialog grows by.
                'flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]'
              : `grid overflow-y-auto overscroll-contain
                 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]`
          )}
        >
          <div className={cx('flex min-w-0 flex-col lg:min-h-0', watching && 'shrink-0')}>
            {/*
              A ratio box with nothing in flow inside it: the poster is 480×360
              and in flow it hands the box a content-based minimum height of its
              own, which stretches the player past 16:9 and shoves the lecture
              list off the screen. Out of flow, the height is the ratio and
              nothing else — capped against the viewport so the list always
              keeps about half the dialog.

              Watching drops the ratio once there are two columns and takes the
              height instead: the stage is then whatever the dialog has left
              over, and the black inside it is the player's own letterbox. Note
              what is *not* here — `shrink-0` alongside `lg:flex-1`, which
              Tailwind emits later and would pin the stage to nothing.
            */}
            <div
              className={cx(
                'relative aspect-video w-full bg-black',
                watching ? 'lg:aspect-auto lg:min-h-0 lg:flex-1' : 'shrink-0 lg:max-h-[42svh]'
              )}
            >
              {playing === null ? (
                <button
                  type="button"
                  className="group absolute inset-0"
                  onClick={playNext}
                  aria-label={t('ui.playlist.play')}
                >
                  {/* Cropped to fill wherever the box is a stated ratio, fitted
                      only on the free-form stage: there the shape is whatever
                      the dialog had left over, and a 4:3 still cropped to a
                      1.3:1 box loses the lecturer off the top and bottom.
                      Fitted, it sits on black exactly where the picture will. */}
                  {poster ? (
                    <img
                      src={poster}
                      alt=""
                      className={cx(
                        'h-full w-full object-cover opacity-70',
                        watching && 'lg:object-contain'
                      )}
                    />
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
                    playlistId: listId,
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

            {/* The controls the frame cannot carry, in the strip below it
                rather than over it: an overlay would sit on YouTube's own
                chrome, and these are pressed while the lecture runs. Only once
                there is a player to talk to — before that they control nothing.

                The two ends are where a player puts them: what it is doing on
                the left, what shape it is in on the right, under the corner of
                the picture and beside the fullscreen button inside the frame,
                because that is the corner a hand already goes to. The one in
                the header stays — it is the way *back* on a dialog that has no
                strip when nothing is playing. */}
            {playing ? (
              <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
                <PlayerSpeed rate={rate} rates={rates} onPick={setRate} />
                <IconButton
                  className="ml-auto"
                  icon={watching ? 'collapse' : 'fit'}
                  label={watching ? t('ui.player.toList') : t('ui.player.theatre')}
                  aria-pressed={watching}
                  onClick={() => setView(watching ? 'list' : 'watch')}
                />
              </div>
            ) : null}

            {/* Which lecture this is, how far into it, and the three controls
                that belong to the one being watched rather than to the
                recording as a whole. Only where the frame is on something the
                shard knows about — see `shown`. */}
            {watching && shown ? (
              <NowPlaying
                video={shown}
                index={shownIndex}
                total={playlist.videos.length}
                at={at?.id === shown.id ? at.sec : 0}
                done={shownDone}
                onPrev={step(-1)}
                onNext={step(1)}
                onToggleDone={() => tick(shownIndex, !shownDone, false)}
              />
            ) : null}

            {/* The lecture list comes from the shard, not from the API. It
                stands under the frame while the recording is being read about
                and moves into the sidebar while it is being watched — one list
                either way, because two would be two sets of ticks. */}
            {watching ? null : (
              <LectureList
                videos={playlist.videos}
              audience={playlist.audience}
                playingId={shownId}
                complete={progress.complete}
                onPlay={play}
                onTick={tick}
                className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
              />
            )}
          </div>

          <aside
            className={cx(
              `flex min-w-0 flex-col border-t border-line
               lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-l lg:border-t-0`,
              watching && 'min-h-0 flex-1 overflow-y-auto overscroll-contain'
            )}
          >
            {watching ? (
              <>
                {/*
                  Where the recording as a whole stands, over the queue it is
                  counted from. Sticky, because it is the one line here that
                  the reader is coming back to between lectures and the queue
                  under it can be a hundred rows long.

                  Before anything has been watched it says how big the thing
                  is instead: a bar at nought over «0 из 26» is the lecture
                  count printed twice, once as a shape that says nothing.
                */}
                <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-2.5">
                  {progress.started ? (
                    <>
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
                      {/* The two facts a percentage cannot carry: how near the
                          next stage is, and where the rest of the audience
                          got to. Both are about this recording and belong
                          with the bar that measures it. */}
                      <MilestoneLine playlist={playlist} className="mt-1" /> {/* [game:milestones] */}
                      <AudienceLine playlist={playlist} progress={progress} className="mt-0.5" />
                      {/* [game:audience] */}
                    </>
                  ) : (
                    <p className="num text-[11px] text-ink-faint">
                      {count(playlist.videoCount, 'lecture')} ·{' '}
                      {t('ui.playlist.hours', {
                        n: formatHours(hoursFromSeconds(playlist.totalSeconds)),
                      })}
                    </p>
                  )}
                  {/* Outside the branch: the day is the reader's and does not
                      depend on whether they have started this particular
                      recording. [game:today] */}
                  <TodayLine className="mt-1" />
                </div>

                {seriesNav ? <div className="px-4 pb-3">{seriesNav}</div> : null}

                <LectureList
                  videos={playlist.videos}
              audience={playlist.audience}
                  playingId={shownId}
                  complete={progress.complete}
                  follow
                  onPlay={play}
                  onTick={tick}
                />

                {/* The fact sheet does not go away while the lecture runs, it
                    goes below the queue: «who is this, how long, is it any
                    good» is asked as often on the third lecture as on the
                    first. The heading is what says there is more under the
                    list. */}
                <p className="mono-label border-t border-line px-4 pt-4">{t('ui.player.about')}</p>
              </>
            ) : null}

            <div className="min-w-0 p-4">
              <p className="text-sm font-medium text-ink">
                {lecturerFilter ? (
                  <FilterName
                    on={lecturerFilter.on}
                    name={lecturerFilter.name}
                    onClick={lecturerFilter.press}
                  />
                ) : (
                  (playlist.lecturer ?? playlist.channelTitle)
                )}
              </p>
              <p className="num mt-1 text-xs text-ink-faint">
                {providerFilter ? (
                  <FilterName
                    on={providerFilter.on}
                    name={providerFilter.name}
                    onClick={providerFilter.press}
                  />
                ) : (
                  provider?.title
                )}
                {(providerFilter || provider?.title) && rest ? ' · ' : null}
                {rest}
              </p>

              {watching ? null : seriesNav}

              {/* One recording, two courses — «Алгоритмы и структуры данных»
                  is a semester of both, and saying so is how the reader knows
                  they are not looking at a stray. */}
              {alsoCovers.length ? (
                <p className="mt-3 text-xs text-ink-faint">
                  {t('ui.playlist.alsoCovers', {
                    courses: alsoCovers.map((id) => t(`course.${id}.title`)).join(', '),
                  })}
                </p>
              ) : null}

              {/* Above the fact sheet, because it is the one thing here that is
                  about the reader rather than about the recording. Absent until
                  there is something to say: an empty bar over «0 из 30» repeats
                  the lecture count two lines below it — and absent while
                  watching, where it stands over the queue instead. */}
              {progress.started && !watching ? (
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
                  <MilestoneLine playlist={playlist} className="mt-1" /> {/* [game:milestones] */}
                  <AudienceLine playlist={playlist} progress={progress} className="mt-0.5" />
                  {/* [game:audience] */}
                </div>
              ) : null}

              {/* How big the thing is, in the three numbers somebody deciding
                  whether to take it on actually weighs. Tiles rather than the
                  «характеристика · значение» lines that were here: those three
                  numbers were set in the same small grey type as the five
                  categorical facts under them, and the one question the sheet
                  is opened with — how many hours is this — had to be found
                  among them. See `Facts.tsx`. */}
              <FactTiles className="mt-4">
                <FactTile
                  icon="list"
                  value={String(playlist.videoCount)}
                  label={t('ui.playlist.label.lectures')}
                />
                <FactTile
                  icon="clock"
                  value={t('ui.playlist.hours', {
                    n: formatHours(hoursFromSeconds(playlist.totalSeconds)),
                  })}
                  label={t('ui.playlist.label.total')}
                />
                <FactTile
                  icon="hourglass"
                  value={t('ui.playlist.avgLecture', {
                    n: formatMinutes(playlist.medianSeconds),
                  })}
                  label={t('ui.playlist.label.avg')}
                />
              </FactTiles>

              {/* And the fourth number, which is the three above divided by the
                  reader rather than by anything about the recording: how many
                  weeks of their own studying this is. It sits under the tiles
                  because it is only an answer once «82 ч» has been read.
                  [game:weeks] */}
              <WeekPlan playlist={playlist} progress={progress} className="mt-2" />

              {/* What the recording *is*, in the words it is one of a few of.
                  A category laid out as a value in a table is a word pretending
                  to be data — «тип · Разная длина» is two words where one of
                  them is a column heading. As chips they are what they always
                  were: tags, read in whatever order the eye lands on them. */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {/* Here even when it is «Лекции», which the row leaves unsaid:
                    the row is a list to be scanned and this is a sheet about
                    one recording, where the ordinary answer is still an
                    answer. */}
                <Chip hint={t(`ui.playlist.type.${playlistTypeOf(playlist)}.hint`)}>
                  {t(`ui.playlist.type.${playlistTypeOf(playlist)}`)}
                </Chip>
                {/* The classification of the number in the tile above it, which
                    is why it wears the same glyph. */}
                <Chip icon="hourglass">{t(`ui.playlist.length.${playlist.lectureLength}`)}</Chip>
                {/* Only «фрагмент», which is the half of this field worth
                    printing. «Полнота: неизвестна» is a line about the
                    catalogue rather than about the playlist, and «полнота:
                    полный курс» is a regex over the title plus «twelve videos
                    or more» — 77% of the catalogue passes it, and it said the
                    same thing the type beside it says on structural evidence.
                    Two answers, one of them cheap.

                    In the warning colour, like «Подборка» on a row and for the
                    same reason: it is the one word here that changes what you
                    would do with the recording. */}
                {playlist.completeness !== 'partial' ? null : (
                  <Chip className="text-warning" hint={t('ui.playlist.label.completeness')}>
                    {t(`ui.playlist.completeness.${playlist.completeness}`)}
                  </Chip>
                )}
                <Chip icon="captions" hint={t('ui.playlist.label.captions')}>
                  {playlist.captions.length
                    ? playlist.captions.join(', ')
                    : t('ui.playlist.noCaptions')}
                </Chip>
              </div>

              <div className="mt-4 space-y-2">
                <Meter
                  icon="eye"
                  label={t('ui.playlist.views')}
                  value={formatCompact(playlist.stats.views, lang)}
                  fraction={1}
                  hint={t('ui.playlist.relativeHint')}
                />
                <Meter
                  icon="like"
                  label={t('ui.playlist.likes')}
                  value={formatCompact(playlist.stats.likes, lang)}
                  fraction={
                    playlist.stats.views ? (playlist.stats.likes / playlist.stats.views) * 12 : 0
                  }
                  hint={t('ui.playlist.relativeHint')}
                />
                <Meter
                  icon="comment"
                  label={t('ui.playlist.comments')}
                  value={formatCompact(playlist.stats.comments, lang)}
                  fraction={
                    playlist.stats.views ? (playlist.stats.comments / playlist.stats.views) * 60 : 0
                  }
                  hint={t('ui.playlist.relativeHint')}
                />
                {/* The share of the audience still there at the end — the one
                    number here that is about the course rather than its size,
                    and the only bar on this sheet that is a real share of a
                    real whole. Hence the accent, and the finish flag. */}
                {retention !== null ? (
                  <Meter
                    icon="flag"
                    tone="accent"
                    label={t('ui.playlist.retention')}
                    value={`${Math.round(retention * 100)}%`}
                    fraction={retention}
                    hint={t('ui.playlist.retentionValue', {
                      percent: `${Math.round(retention * 100)}%`,
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
                phone, the sidebar itself once it is a column. It lets go on a
                phone that is watching: three buttons about the recording as a
                whole, standing over a queue that has three rows left, are the
                wrong three inches of a screen that has the video and its
                controls above it already. They scroll into reach instead. */}
            <div
              className={cx(
                'mt-auto space-y-1.5 border-t border-line bg-surface p-4',
                watching ? 'lg:sticky lg:bottom-0' : 'sticky bottom-0'
              )}
            >
              {/* The end of a long recording, said as an event and not as a
                  checkbox — with the courses it has just opened, which is the
                  one reward this catalogue can hand out honestly because the
                  graph already knows it. Above the course-promoted line: that
                  one is about a status changing, this is about the work.
                  [game:finish] */}
              <FinishCard
                playlist={playlist}
                progress={progress}
                hrefFor={(id) => courseHref(id, courseSearch)}
              />
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
              {/* Two decisions about the recording as a whole — save it for
                  later, and call the whole thing watched — and neither is a
                  thing anybody does while a lecture is running. They belong to
                  the sheet somebody reads before starting; on the watching
                  screen they would be two full-width buttons of nothing to do,
                  one of which wipes the ticks of a course in progress. What
                  marking off looks like here is one lecture at a time, under
                  the picture and down the queue. */}
              {watching ? null : (
                <>
                  <Button
                    variant={favorite ? 'primary' : 'default'}
                    icon={favorite ? 'star-filled' : 'star'}
                    iconSize={16}
                    className="w-full justify-center"
                    onClick={() => toggleFavorite(playlist.id)}
                  >
                    {favorite ? t('ui.course.favoriteOn') : t('ui.course.favorite')}
                  </Button>
                  {/* The label names what the press does. Half way through, that
                      is «отметить все 30» — not «просмотрено», which is a claim
                      about a state the row of ticks above already contradicts. */}
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
                </>
              )}
              <ButtonLink
                href={watchUrl(listId, shownId ?? playlist.videos[0]?.id)}
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


