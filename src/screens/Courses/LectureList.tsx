import { Fragment, useEffect, useMemo, useRef } from 'react';
import type { Video } from '@shared/schema';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { GAME, segmentsOf } from '@/lib/gamification';
import { isResumable } from '@/lib/youtube';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import { AudienceMark } from '@/components/game/Audience';
import { SegmentHeader } from '@/components/game/Milestone';

type Props = {
  videos: Video[];
  /**
   * [game:audience] The share of the audience still there at each lecture, or
   * nothing where the view curve is not a course's — see `gamification.ts`.
   */
  audience?: number[];
  /**
   * The lecture in the frame right now, which is not always the one that was
   * asked for: with `list=` YouTube walks to the next one by itself.
   */
  playingId: string | null;
  /** Every row counts as watched — the playlist was sealed or fully ticked. */
  complete: boolean;
  /**
   * Keep the playing row in view.
   *
   * On in the watching view, where this list is the queue beside a running
   * lecture and a highlight three screens down answers nothing; off beside the
   * fact sheet, where the reader is scrolling the list themselves and having it
   * jump under them would be the opposite of help.
   */
  follow?: boolean;
  onPlay: (video: Video) => void;
  onTick: (index: number, next: boolean, extend: boolean) => void;
  className?: string;
};

/**
 * The lectures of a recording, with a tick each.
 *
 * The same list in both shapes of the player dialog — under the frame while a
 * recording is being read about, beside it while it is being watched — because
 * it is the same list and a second copy would be a second set of ticks to keep
 * in step.
 */
export default function LectureList({
  videos,
  audience,
  playingId,
  complete,
  follow = false,
  onPlay,
  onTick,
  className = '',
}: Props) {
  const { t } = useT();
  const list = useRef<HTMLOListElement>(null);

  /*
   * [game:milestones] Where the stages start, keyed by the row that opens one.
   *
   * Empty for anything short enough to be read whole — `segmentsOf` refuses
   * rather than cutting a twelve-lecture course into three — so the ordinary
   * list is exactly the list it was.
   */
  const headers = useMemo(() => {
    if (!GAME.milestones) return new Map<number, ReturnType<typeof segmentsOf>[number]>();
    return new Map(segmentsOf(videos).map((segment) => [segment.from, segment]));
  }, [videos]);

  /*
   * `block: 'nearest'` rather than `center`: a row already on screen is left
   * exactly where it is, which is the case every time the reader picked the
   * lecture themselves. It moves only when the player walked somewhere the
   * reader cannot see — the next lecture, an hour into a course.
   */
  useEffect(() => {
    if (!follow || !playingId) return;
    list.current
      ?.querySelector<HTMLElement>('[data-playing="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [follow, playingId]);

  return (
    <ol ref={list} className={`divide-y divide-line ${className}`}>
      {videos.length ? (
        videos.map((video, index) => (
          <Fragment key={video.id}>
            {/* [game:milestones] */}
            {headers.has(index) ? (
              <SegmentHeader segment={headers.get(index)!} videos={videos} sealed={complete} />
            ) : null}
            <LectureRow
              video={video}
              index={index}
              share={audience?.[index] ?? null}
              playing={playingId === video.id}
              sealed={complete}
              onPlay={() => onPlay(video)}
              onTick={(next, extend) => onTick(index, next, extend)}
            />
          </Fragment>
        ))
      ) : (
        <li className="px-4 py-6 text-center text-sm text-ink-faint">{t('ui.common.loading')}</li>
      )}
    </ol>
  );
}

/**
 * One lecture: a name that plays, how long it runs, and a tick at the end.
 *
 * The tick is last because the list is read before it is used: the eye goes
 * down the titles, and a column of empty boxes in front of them is a form to
 * fill in rather than a lecture list. At the right edge it is where a finished
 * lecture leaves its mark, next to the length it took.
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
  share,
  playing,
  sealed,
  onPlay,
  onTick,
}: {
  video: Video;
  index: number;
  /** [game:audience] The share of the audience still here, 0..100, or nothing. */
  share: number | null;
  playing: boolean;
  /** Counted watched by the playlist's seal rather than by a tick of its own. */
  sealed: boolean;
  onPlay: () => void;
  onTick: (next: boolean, extend: boolean) => void;
}) {
  const { t } = useT();
  const mark = useProfile((state) => state.profile.videos[video.id]);
  const done = sealed || (mark?.done ?? false);
  /** Where the playhead was left, when that is a place worth coming back to. */
  const at = !done && isResumable(mark?.sec) ? mark.sec : 0;
  const part = at ? Math.min(100, (at / Math.max(1, video.seconds)) * 100) : 0;

  /*
   * The hover belongs to the row, not to the button inside it.
   *
   * It used to be on the title button alone, which stops short of the tick —
   * so pointing at a lecture lit a box ending two thirds of the way across,
   * with the tick left standing on the unlit strip beside it. The row is one
   * thing to the reader and highlights as one, the same way a playlist row
   * does; the tick keeps its own ink change to say which half is under the
   * pointer.
   */
  return (
    <li
      data-playing={playing ? 'true' : undefined}
      className={`relative flex items-center transition-colors duration-fast ease-out
                  ${playing ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
    >
      {/* How far into the lecture you are, drawn across the row it is about.
          It was a two-pixel hairline along the bottom edge before, which is
          where the divider between rows already is — and it was painted in
          `bg-accent/60`, an opacity modifier Tailwind silently dropped, so
          there was nothing there at all. See `themed` in tailwind.config.js. */}
      {part ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 bg-accent/15"
          style={{ width: `${part}%` }}
        >
          {/* The playhead itself: the wash says how much, this says exactly
              where, and it is the one mark that stays legible on the row the
              player is currently sitting on. */}
          <span className="absolute inset-y-0 right-0 w-[2px] bg-accent" />
        </span>
      ) : null}

      <button
        type="button"
        onClick={onPlay}
        className={`relative flex min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left text-sm
                    transition-colors duration-fast ease-out
                    ${playing ? 'text-ink' : done ? 'text-ink-faint' : 'text-ink-dim'}`}
      >
        {/* The number, and under it [game:audience] — the crowd at this row.
            One column rather than two: the mark is about this lecture's place
            in the recording, which is what the number says as well. */}
        <span className="w-5 shrink-0">
          <span className="num block text-right text-xs text-ink-faint">{index + 1}.</span>
          <AudienceMark share={share} />
        </span>
        <span className="min-w-0 flex-1 truncate">{video.title}</span>
        {/*
          Both numbers, always in that order: where you are, then how long it
          is. The slot used to hold the position *instead* of the length, which
          made one column mean two different things depending on the row — and
          while the lecture played it was a figure counting up on its own with
          nothing beside it to be counted against. Paired, it reads the way the
          time under any player does.
        */}
        <span className="num shrink-0 text-xs text-ink-faint">
          {at ? (
            <>
              <span className="text-accent">{formatDuration(at)}</span>
              <span className="px-0.5">/</span>
            </>
          ) : null}
          {formatDuration(video.seconds)}
        </span>
      </button>

      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`${t('ui.playlist.markWatched')}: ${video.title}`}
        onClick={(event) => onTick(!done, event.shiftKey)}
        className="relative flex h-11 w-10 shrink-0 items-center justify-center text-ink-faint
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
    </li>
  );
}
