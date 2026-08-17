import { useMemo } from 'react';
import type { BuiltPlaylist, Video } from '@shared/schema';
import { useT } from '@/i18n';
import { GAME, milestoneOf, type Segment } from '@/lib/gamification';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';

/**
 * [game:milestones] — the nearest finish line, and the stages it belongs to.
 *
 * Two shapes of one mechanic. `MilestoneLine` is the offer: how much is left
 * of the stage in hand, which is a number between two and eight and therefore
 * a thing somebody can decide to do tonight. `SegmentHeader` is the structure
 * it comes from, drawn into the lecture list so that sixty rows read as twelve
 * groups rather than as sixty.
 *
 * Neither of them names a stage. The names would have to be invented — see
 * `segmentsOf`, where the 6% of recordings that carry a readable section
 * marker is the measurement that settled it — and an invented name is a claim
 * about a university's course. What is printed instead is what the rows
 * themselves add up to.
 */
export default function MilestoneLine({
  playlist,
  className = '',
}: {
  playlist: BuiltPlaylist;
  className?: string;
}) {
  if (!GAME.milestones) return null;
  return <Line playlist={playlist} className={className} />;
}

function Line({ playlist, className }: { playlist: BuiltPlaylist; className: string }) {
  const { t, count, span } = useT();
  const profile = useProfile((state) => state.profile);
  const milestone = useMemo(() => milestoneOf(profile, playlist), [profile, playlist]);
  if (!milestone) return null;

  return (
    <p className={`num ink-soft text-[11px] ${className}`}>
      {t('ui.game.milestone', {
        lectures: count(milestone.left, 'lecture'),
        time: span(milestone.secondsLeft).text,
      })}
    </p>
  );
}

/**
 * The rule between two stages, carrying what the stage under it is worth.
 *
 * It is a divider and not a lecture, so it leaves the list semantics alone:
 * `role="presentation"` takes it out of the `<ol>` without taking its words
 * away from anybody reading with their ears.
 *
 * Whether the stage is behind the reader is asked here rather than handed
 * down, and asked as a boolean: the list this sits in runs to five hundred
 * rows, and a parent subscribed to every tick would redraw all of them each
 * time one is marked off. A selector returning `true` or `false` re-renders
 * the header on the one change that concerns it.
 */
export function SegmentHeader({
  segment,
  videos,
  sealed,
}: {
  segment: Segment;
  videos: Video[];
  /** The whole recording is marked watched, so every stage in it is. */
  sealed: boolean;
}) {
  const { t, count, span } = useT();
  const done = useProfile((state) => {
    if (sealed) return true;
    for (let index = segment.from; index <= segment.to; index += 1) {
      const video = videos[index];
      if (video && !state.profile.videos[video.id]?.done) return false;
    }
    return true;
  });
  if (!GAME.milestones) return null;

  return (
    <li
      role="presentation"
      className="flex items-center gap-2 bg-surface-2/60 px-4 py-1.5"
    >
      <span className={`mono-label ${done ? 'text-accent' : 'ink-soft'}`}>
        {t('ui.game.segment', { n: segment.index, total: segment.total })}
      </span>
      {/* What the rows under the rule come to — the one number here that is
          measured rather than chosen, and the reason a stage may be printed
          at all. */}
      <span className="num flex-1 truncate text-[11px] text-ink-faint">
        {t('ui.game.segmentSize', {
          lectures: count(segment.to - segment.from + 1, 'lecture'),
          time: span(segment.seconds).text,
        })}
      </span>
      {done ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-accent">
          <Icon name="check" size={11} />
          {t('ui.game.segmentDone')}
        </span>
      ) : null}
    </li>
  );
}
