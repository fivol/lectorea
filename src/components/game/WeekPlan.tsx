import type { BuiltPlaylist } from '@shared/schema';
import { useT } from '@/i18n';
import { GAME, planFor, useWeekPace } from '@/lib/gamification';
import type { PlaylistProgress } from '@/lib/progress';
import Tooltip from '@/components/Tooltip';

/**
 * [game:weeks] — what this recording costs in the reader's own weeks.
 *
 * «82 ч» answers how big the thing is. It does not answer the question anybody
 * standing in front of it actually has, which is whether it fits in their
 * life — and the two are only a division apart, over numbers the site already
 * holds.
 *
 * The pace is the week's goal where somebody set one and the **measured** last
 * four weeks where they did not, which is the half that matters: most readers
 * never set a goal, and a measured pace is a report rather than a target, so
 * it needs no opt-in and hands out no debt. Which of the two it is gets said
 * in the sentence, because a figure computed by a rule the reader cannot
 * re-derive is incomplete until the rule travels with it.
 */
export default function WeekPlan({
  playlist,
  progress,
  className = '',
}: {
  playlist: BuiltPlaylist;
  progress: PlaylistProgress;
  className?: string;
}) {
  if (!GAME.weeks) return null;
  return <Plan playlist={playlist} progress={progress} className={className} />;
}

function Plan({
  playlist,
  progress,
  className,
}: {
  playlist: BuiltPlaylist;
  progress: PlaylistProgress;
  className: string;
}) {
  const { t, count, span, lang } = useT();
  const pace = useWeekPace();

  // What is left rather than the whole: half way through a course the question
  // has changed, and the answer to it has too.
  const totalSeconds = progress.totalSeconds || playlist.totalSeconds;
  const remaining = Math.max(0, totalSeconds - progress.watchedSeconds);
  const plan = planFor(remaining, pace);
  if (!plan || progress.complete) return null;

  /*
   * Both halves of the pair are written out rather than picked with a ternary
   * inside `t(…)`: `check-i18n` reads the keys off the source as literals, and
   * a key assembled at the call site is a key it reports as dead and somebody
   * eventually deletes.
   */
  const paceText = span(plan.pace.secondsPerWeek).text;
  const params = { weeks: count(plan.weeks, 'week'), pace: paceText };
  const fromGoal = plan.pace.source === 'goal';
  const howLong = fromGoal ? t('ui.game.planGoal', params) : t('ui.game.planPace', params);
  const sentence = plan.date
    ? `${howLong} · ${t('ui.game.planBy', { date: monthDay(plan.date, lang) })}`
    : t('ui.game.planLong', { pace: paceText });

  return (
    <Tooltip tap content={fromGoal ? t('ui.legend.planGoal') : t('ui.legend.planPace')}>
      <p className={`num ink-soft cursor-help text-[11px] ${className}`}>{sentence}</p>
    </Tooltip>
  );
}

/**
 * «15 декабря». The year is left off on purpose: a plan runs a year at the
 * outside — past that `planFor` refuses to print a date at all — and «2026 г.»
 * on the end of a sentence about next spring is a word doing no work.
 */
function monthDay(date: Date, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'long',
  }).format(date);
}
