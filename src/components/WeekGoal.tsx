import { useState } from 'react';
import { useT } from '@/i18n';
import { WEEK_GOALS, useWeekGoal, type WeekGoal } from '@/lib/activity';
import { formatHours } from '@/lib/format';
import { useProfile } from '@/store/profile';
import Icon from './Icon';
import ProgressBar from './ProgressBar';
import { Button, Segmented } from './ui';

/**
 * A week to aim at, and how far into it the reader is.
 *
 * The one number on these screens that somebody chooses rather than earns.
 * Everything else in the profile is a report — hours behind you, days in a row,
 * lectures ticked — and a report answers "how am I doing" only if there is
 * something to do it against. «4,1 часа» is a fact; «4,1 из 5 часов» is a
 * position.
 *
 * It is off until it is set, and one press away from off again. A goal handed
 * to somebody who came here to watch one lecture is a debt they did not take
 * on, and the shelf of debts is exactly what makes people stop opening a
 * profile — the same argument the path bar downstairs is written against.
 *
 * Two shapes of the same thing: the bar alone on the front page, where there is
 * no room to argue with it, and the bar plus the row of choices in the panel,
 * where the choosing belongs.
 */

/** The bar and its caption — «4.1 из 5 часов». Nothing at all without a goal. */
export function WeekGoalBar({ className = '' }: { className?: string }) {
  const goal = useWeekGoal();
  if (!goal) return null;
  return <GoalBar goal={goal} className={className} />;
}

function GoalBar({ goal, className = '' }: { goal: WeekGoal; className?: string }) {
  const { t } = useT();

  return (
    <ProgressBar
      // Clamped for the bar's own `aria-valuenow`, which has to sit inside its
      // range — «4,1 из 3» is a fine thing to read and not a thing to announce.
      // The label below still says what was really done.
      done={Math.min(goal.done, goal.hours)}
      total={goal.hours}
      fill={goal.fraction}
      className={className}
      /*
       * Both numbers in hours whatever the size of either: «45 минут из 5
       * часов» is two units in one sentence, and the reader has to convert one
       * of them before the comparison the line exists for can happen.
       *
       * The unit is abbreviated, and that is grammar rather than economy.
       * Russian «из» takes the genitive, where every numeral above one wants
       * «часов» — «из 3 часов» — while the plural rule the rest of the site
       * runs on would agree it with the numeral and write «из 3 часа». «ч»
       * does not decline, so the line is right in every language that writes
       * its own template around it.
       */
      label={t('ui.profile.goal.of', { done: formatHours(goal.done), goal: goal.hours })}
    />
  );
}

/**
 * The bar with the choosing attached: the panel's copy.
 *
 * The row of hours is folded away once a goal is set. It is a decision somebody
 * makes about once, and a permanent strip of seven buttons under a number reads
 * as a control panel rather than as a week.
 */
export function WeekGoalRow() {
  const { t } = useT();
  const goal = useWeekGoal();
  const setSetting = useProfile((state) => state.setSetting);
  const [editing, setEditing] = useState(false);

  const choose = (hours: number | null): void => {
    setSetting('weekGoal', hours);
    setEditing(false);
  };

  if (!goal && !editing) {
    return (
      <div className="mt-2 border-t border-line pt-2">
        {/* A ghost is a word rather than a plate and carries no layout of its
            own, so the star in front of it needs one — otherwise the icon
            takes a line to itself. */}
        <Button
          variant="ghost"
          small
          icon="star"
          className="inline-flex items-center gap-1.5"
          onClick={() => setEditing(true)}
        >
          {t('ui.profile.goal.set')}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2">
      <div className="flex items-baseline gap-2 text-xs text-ink-faint">
        <span>{t('ui.profile.goal.week')}</span>
        {goal?.met ? (
          <span className="flex items-center gap-1 text-accent">
            <Icon name="check" size={12} />
            {t('ui.profile.goal.met')}
          </span>
        ) : null}
        <Button
          variant="ghost"
          small
          className="ml-auto shrink-0"
          onClick={() => setEditing(!editing)}
          aria-expanded={editing}
        >
          {editing ? t('ui.common.close') : t('ui.profile.goal.change')}
        </Button>
      </div>

      {goal ? <GoalBar goal={goal} /> : null}

      {editing ? (
        <Segmented
          value={String(goal?.hours ?? 0)}
          label={t('ui.profile.goal.week')}
          options={[
            { value: '0', label: t('ui.profile.goal.off') },
            // Short forms — «5 ч» — because seven full ones do not fit a phone
            // and the row would scroll past its own options.
            ...WEEK_GOALS.map((hours) => ({
              value: String(hours),
              label: t('ui.profile.goal.hours', { n: hours }),
            })),
          ]}
          onChange={(value) => choose(Number(value) || null)}
        />
      ) : null}
    </div>
  );
}
