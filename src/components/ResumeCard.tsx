import { useState, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { percent, type PlaylistProgress, type ResumePointer } from '@/lib/progress';
import Icon from './Icon';
import ProgressBar from './ProgressBar';
import { IconButton } from './ui';

/**
 * «Продолжить» — one object in the product for «where you stopped».
 *
 * It is asked for in two places that know different amounts. The front page
 * knows the recording that was open and nothing about what is inside it, so it
 * offers the recording; the course panel has the shard in hand and offers the
 * lecture itself, numbered. Both are the same press and should be the same
 * thing to look at — a still with a play mark on it, the word, and the name —
 * because a reader who learns it in the corner of the map should not have to
 * learn it again inside a course.
 *
 * The still is the whole of the affordance: a thumbnail with a play disc over
 * it is the one control on the internet nobody has to be taught.
 */
export function ResumeCard({
  videoId,
  title,
  subtitle,
  progress,
  onClick,
  className = '',
}: {
  videoId?: string;
  title: ReactNode;
  /** The course under the recording, the lecture's length — whatever the caller knows. */
  subtitle?: ReactNode;
  /**
   * How far through the recording is behind you, once somebody has paid for the
   * shard that knows — see `useResumeProgress`. Absent where the caller draws
   * its own bar underneath, as the course panel does, and absent until the file
   * lands, which is why the card has to read without it.
   */
  progress?: PlaylistProgress | null;
  onClick: () => void;
  className?: string;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      /*
        `w-full` is not decoration: a button sizes itself to its content even
        when it is a block-level flex container, so without it the row grows to
        the width of the lecture's title and the truncation below never fires —
        which is exactly how the name ran off the edge of the card.
      */
      className={`inlay-hover group flex w-full min-w-0 flex-col gap-1 rounded-card p-1
                  text-left ${className}`}
    >
      <span className="flex w-full min-w-0 items-center gap-2.5">
        <LectureThumb videoId={videoId} className="h-11 w-[4.5rem] shrink-0" iconSize={13} />
        <span className="min-w-0 flex-1">
          <span className="mono-label block text-accent">{t('ui.profile.continue')}</span>
          <span className="mt-0.5 block truncate text-sm font-semibold text-ink">{title}</span>
          {subtitle ? (
            <span className="block truncate text-[11px] text-ink-faint">{subtitle}</span>
          ) : null}
        </span>
      </span>
      {/* Under the whole row rather than under the title: it measures the
          recording, and a bar indented to clear the still would read as a
          property of the words beside it. Only once there is something to
          measure — a bar at zero on a recording opened and not started says
          less than no bar. */}
      {progress?.started ? (
        <ProgressBar
          className="w-full px-0.5 pb-0.5"
          done={progress.done}
          total={progress.total}
          fill={progress.fraction}
          label={`${percent(progress.fraction)}%`}
        />
      ) : null}
    </button>
  );
}

/**
 * Which of the started recordings the card is showing, and the two presses that
 * change it.
 *
 * The index is held here rather than by the caller because it is nobody else's
 * business, and it wraps in both directions: a list that shrinks underneath it —
 * a playlist finished, a filter narrowed — lands somewhere valid instead of on
 * nothing.
 */
export function useResumeCarousel(list: ResumePointer[]): {
  current: ResumePointer | null;
  index: number;
  count: number;
  prev: () => void;
  next: () => void;
} {
  const [at, setAt] = useState(0);
  const count = list.length;
  const index = count ? ((at % count) + count) % count : 0;

  return {
    current: count ? list[index] : null,
    index,
    count,
    prev: () => setAt(at - 1),
    next: () => setAt(at + 1),
  };
}

/**
 * The two arrows, and the count that explains why they are there.
 *
 * A reader with three courses on the go was being offered one of them and told
 * nothing about the other two — the card looked like a statement about their
 * study rather than the first of several. «2 / 10» says how many there are and
 * where in them you are, which is the whole of what the arrows need to be
 * understood.
 *
 * Both directions, and both wrap. One arrow was enough to reach everything and
 * not enough to *use*: overshooting by one press meant nine more to come back
 * round, and the reader who had just seen the thing they wanted had no way back
 * to it. Nothing is disabled at either end, because there are no ends.
 *
 * Its own row under the offer rather than up in the header. Three controls and a
 * counter beside a heading leave a heading about ninety pixels wide, and
 * «ПРОГРЕСС · МАТЕМА…» is a card that has truncated the one word saying what it
 * is counting. Down here the width is nobody else's — so the row takes the
 * middle of it rather than one edge: pushed right it read as a third piece of
 * corner chrome under the ×, when what it steers is the card above it.
 *
 * Absent below two, where an arrow would be a lie about there being more.
 */
export function ResumeStepper({
  index,
  count,
  onPrev,
  onNext,
}: {
  index: number;
  count: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t } = useT();
  if (count < 2) return null;

  return (
    <div className="flex items-center justify-center gap-1">
      <IconButton icon="chevron-left" iconSize={14} label={t('ui.home.prev')} onClick={onPrev} />
      <span className="num shrink-0 text-[11px] text-ink-faint">
        {index + 1}/{count}
      </span>
      <IconButton icon="chevron-right" iconSize={14} label={t('ui.home.next')} onClick={onNext} />
    </div>
  );
}

/** A lecture's still, with the play mark that says it is a lecture and not a picture. */
export function LectureThumb({
  videoId,
  className,
  iconSize,
}: {
  videoId?: string;
  className: string;
  iconSize: number;
}) {
  return (
    <span className={`relative overflow-hidden rounded bg-surface-2 ${className}`}>
      {videoId ? (
        <img
          src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : null}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-canvas/70 text-ink transition-transform duration-fast ease-out group-hover:scale-110">
          <Icon name="play" size={iconSize} />
        </span>
      </span>
    </span>
  );
}
