import { useMemo, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { ACTIVITY_WINDOW, useActivity } from '@/lib/activity';
import { useCatalog } from '@/lib/catalog';
import { formatDate, formatHours, hoursFromSeconds } from '@/lib/format';
import { useGoalsProgress } from '@/lib/goals';
import { percent, useWatchedTotals } from '@/lib/progress';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import ProgressBar from '@/components/ProgressBar';

/**
 * What the profile is for, said in numbers before any list of anything.
 *
 * Every one of them is labelled with what it counts, because a big «27» over
 * the word «лекций» is four different facts depending on who is reading: watched,
 * saved, available, left. They are also all about the same thing — what this
 * reader has done — which is what the heading is for.
 *
 * Three of them only ever go up, one says whether it is still happening, and
 * the bar underneath is the only one with somewhere to get to. A shelf of goals
 * on its own is a list of debts, and opening the panel to nothing but debts is
 * why people stop opening it.
 */
export default function ProfileStats() {
  const { t, plural } = useT();
  const catalog = useCatalog();
  const courses = useProfile((state) => state.profile.courses);
  const watched = useWatchedTotals();
  const activity = useActivity();
  const goals = useGoalsProgress();

  const done = useMemo(() => {
    let total = 0;
    for (const [id, entry] of Object.entries(courses)) {
      if (entry.status === 'done' && catalog.courseById.has(id)) total += 1;
    }
    return total;
  }, [courses, catalog]);

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{t('ui.profile.stats.title')}</h3>

      {/*
        Every caption names what it counts, and takes the form of the number
        over it: «4 курсов пройдено» is a label somebody has to forgive, and
        the noun is the one word here that can agree without a sentence around
        it. The qualifier after it never inflects, in either language.
      */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {/* «≈» because lecture lengths live in the playlist shards and the ones
            that have not landed are counted as nothing rather than guessed at. */}
        <Tile
          value={`≈${formatHours(hoursFromSeconds(watched.seconds))}`}
          label={t('ui.profile.stats.hours', {
            noun: plural(Math.round(hoursFromSeconds(watched.seconds)), 'hour'),
          })}
        />
        <Tile
          value={watched.lectures}
          label={t('ui.profile.stats.lectures', {
            noun: plural(watched.lectures, 'lecture'),
          })}
        />
        <Tile
          value={done}
          label={t('ui.profile.stats.courses', { noun: plural(done, 'course') })}
        />
        <Tile
          value={activity.streak}
          label={t('ui.profile.stats.streak', { noun: plural(activity.streak, 'day') })}
          // Only when it says something the number above does not: a personal
          // best equal to the run in hand is the same fact printed twice.
          hint={
            activity.best > activity.streak
              ? t('ui.profile.stats.best', { n: activity.best })
              : undefined
          }
        />
      </div>

      {activity.total ? <ActivityStrip /> : null}

      {goals.goals ? (
        <div className="surface p-3">
          <div className="mb-2 flex items-baseline gap-2">
            <h4 className="text-sm font-medium">{t('ui.profile.stats.goalPath')}</h4>
            {goals.remainingHours > 0 ? (
              <span className="num ml-auto text-xs text-ink-faint">
                {t('ui.profile.remaining', { hours: formatHours(goals.remainingHours) })}
              </span>
            ) : null}
          </div>
          <ProgressBar
            done={goals.progress.done}
            total={goals.progress.total}
            partial={goals.progress.partial}
            label={`${percent(goals.progress.fraction)}% · ${t('ui.profile.progress', {
              done: goals.progress.done,
              total: goals.progress.total,
            })}`}
          />
        </div>
      ) : (
        /* Progress with no goal is a set of ticks with nothing to add up to,
           so the panel says what turns them into one. */
        <p className="surface flex items-start gap-2 p-3 text-xs text-ink-faint">
          <Icon name="star" size={13} className="mt-0.5 shrink-0" />
          {t('ui.profile.noGoal')}
        </p>
      )}
    </section>
  );
}

/**
 * Four weeks of days, one square each.
 *
 * The only thing in the profile that shows a shape rather than a number: what a
 * reader wants to know about their own habit is whether it has holes in it, and
 * twenty-eight squares answer that at a glance in a way «12 дней» never can.
 */
function ActivityStrip() {
  const { t, count, lang } = useT();
  const activity = useActivity();

  return (
    <div className="surface p-3">
      <div className="mb-2 flex items-baseline gap-2 text-xs text-ink-faint">
        <span>{t('ui.profile.stats.lastWeeks', { n: ACTIVITY_WINDOW / 7 })}</span>
        {/* The context for the run in the tile above: a total belongs beside the
            days it counts, not in a headline of its own. */}
        <span className="num ml-auto">
          {t('ui.profile.stats.daysTotal', { days: count(activity.total, 'day') })}
        </span>
      </div>
      <div className="flex gap-[3px]">
        {activity.recent.map(({ day, studied }, index) => (
          <span
            key={day}
            // Midday, so that formatting it in the reader's own zone cannot
            // walk the date back to the day before.
            title={formatDate(`${day}T12:00`, lang)}
            className={`h-4 flex-1 rounded-[2px] ${studied ? 'bg-accent' : 'bg-surface-2'} ${
              // Today is the last square, and it is the one worth finding: a run
              // is a thing you keep, and keeping it is about today.
              index === activity.recent.length - 1 && !studied
                ? 'ring-1 ring-inset ring-line-strong'
                : ''
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function Tile({
  value,
  label,
  hint,
}: {
  value: string | number;
  label: string;
  hint?: ReactNode;
}) {
  return (
    <div className="surface flex flex-col items-center gap-0.5 px-2 py-3 text-center">
      <span className="num text-h2 leading-none text-ink">{value}</span>
      <span className="text-[11px] leading-tight text-ink-faint">{label}</span>
      {hint ? <span className="num text-[10px] leading-tight text-ink-faint">{hint}</span> : null}
    </div>
  );
}
