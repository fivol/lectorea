import { useMemo } from 'react';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatHours, hoursFromSeconds } from '@/lib/format';
import { useGoalsProgress } from '@/lib/goals';
import { percent, useWatchedTotals } from '@/lib/progress';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import ProgressBar from '@/components/ProgressBar';

/**
 * What the profile is for, said in four numbers before any list of anything.
 *
 * Three of them are what has been spent — hours, lectures, courses — and they
 * only ever go up, which is the point: a shelf of goals is a list of debts, and
 * opening the panel to nothing but debts is why people stop opening it. The
 * fourth is the one that has a direction: how much of the path to everything
 * you said you wanted is already behind you.
 *
 * The hours are a floor and say so with «≈» — lecture lengths live in the
 * shards, and the ones that have not landed yet are counted as nothing rather
 * than guessed at.
 */
export default function ProfileStats() {
  const { t } = useT();
  const catalog = useCatalog();
  const courses = useProfile((state) => state.profile.courses);
  const watched = useWatchedTotals();
  const goals = useGoalsProgress();

  const done = useMemo(() => {
    let count = 0;
    for (const [id, entry] of Object.entries(courses)) {
      if (entry.status === 'done' && catalog.courseById.has(id)) count += 1;
    }
    return count;
  }, [courses, catalog]);

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Tile
          value={`≈${formatHours(hoursFromSeconds(watched.seconds))}`}
          label={t('ui.profile.stats.hours')}
        />
        <Tile value={watched.lectures} label={t('ui.profile.stats.lectures')} />
        <Tile value={done} label={t('ui.profile.stats.courses')} />
      </div>

      {goals.goals ? (
        <div className="surface p-3">
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-sm font-medium">{t('ui.profile.stats.goalPath')}</h3>
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

function Tile({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="surface flex flex-col items-center gap-0.5 px-2 py-3 text-center">
      <span className="num text-h2 leading-none text-ink">{value}</span>
      <span className="text-[11px] leading-tight text-ink-faint">{label}</span>
    </div>
  );
}
