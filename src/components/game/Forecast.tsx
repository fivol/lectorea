import { useT } from '@/i18n';
import { useDayGoal } from '@/lib/activity';
import { GAME, horizonFor, useWeekPace } from '@/lib/gamification';
import Tooltip from '@/components/Tooltip';

/**
 * [game:weeks] — «осталось ≈43 ч», said in the reader's own time.
 *
 * Hours are the one unit in which "how much is left" is not an answer. Forty
 * hours is a fortnight for one reader and most of a year for another, and the
 * site knows which: the goal says what a week of theirs holds, and where no
 * goal is set the last four weeks say it instead. So every place that prints a
 * remainder gets the same division after it — the path in the course panel,
 * the goals bar in the profile, a goal card, a course being studied.
 *
 * One component rather than the sentence four times over, for the reason the
 * hours themselves are one string: the four sites would otherwise drift, and
 * the fifth would be written without it. It renders nothing at all when there
 * is no pace to divide by, which is every reader who has neither set a goal
 * nor studied three days in the last month.
 */
export default function Forecast({
  /** What is left, in seconds — the same figure the hours beside it are printed from. */
  seconds,
  className = '',
}: {
  seconds: number;
  className?: string;
}) {
  if (!GAME.weeks) return null;
  return <Span seconds={seconds} className={className} />;
}

function Span({ seconds, className }: { seconds: number; className: string }) {
  const { t, count } = useT();
  const pace = useWeekPace();
  const day = useDayGoal();
  const horizon = horizonFor(seconds, pace, day?.seconds ?? null);
  if (!horizon) return null;

  /*
   * The three nouns are written out rather than picked into one `t(…)`, so
   * `check:i18n` can see the keys — see the practice. `count` handles the
   * agreement, which in Russian is the whole difficulty: «≈2 недели»,
   * «≈5 недель».
   */
  const span =
    horizon.unit === 'over'
      ? null
      : horizon.unit === 'day'
        ? count(horizon.value, 'studyDay')
        : horizon.unit === 'week'
          ? count(horizon.value, 'week')
          : count(horizon.value, 'month');

  return (
    <Tooltip
      tap
      content={pace?.source === 'goal' ? t('ui.legend.planGoal') : t('ui.legend.planPace')}
    >
      <span className={`num cursor-help ${className}`}>
        {span === null ? t('ui.game.horizonLong') : t('ui.game.horizon', { span })}
      </span>
    </Tooltip>
  );
}
