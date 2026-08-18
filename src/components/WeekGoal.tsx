import { useState } from 'react';
import { useT } from '@/i18n';
import { DAY_GOALS, GOAL_DAYS, useDayGoal, useWeekGoal, type WeekGoal } from '@/lib/activity';
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

/**
 * The front page's copy: what the bar is, then the bar.
 *
 * The name is not decoration here. On the panel the bar stands under a heading
 * and beside the week it is measured against; on a plate in the corner of a map
 * it stands under three tiles of its own, and «0.9 из 5 ч» on its own is a
 * riddle — five of what, and whose. One line answers it, and the mark in front
 * of the line is the same one the panel puts on the setting.
 */
export function WeekGoalBar({ className = '' }: { className?: string }) {
  const goal = useWeekGoal();
  if (!goal) return null;

  return (
    <div className={`space-y-1 ${className}`}>
      <GoalName goal={goal} size={11} className="text-[10px] leading-none" />
      <GoalBar goal={goal} />
    </div>
  );
}

/**
 * What the bar is, and whether it is finished with.
 *
 * The two screens say it the same way, at two sizes. A week that has been made
 * says so in a word — a full bar is a fact somebody has to read off a shape,
 * and «выполнена» is the one thing worth saying out loud on the day it happens.
 *
 * Made means **the days are made**, not the hours. A goal here is «45 минут, 5
 * дней в неделю», and four and a half hours in two long Sundays is the hours of
 * that week without the habit in it: the word and the «2 из 5 дней закрыто»
 * three lines below were contradicting each other, and a reader settles that
 * kind of pair by trusting neither. The hours keep the bar and its number —
 * see `GoalBar`, which accents its own label on its own reading.
 */
function GoalName({
  goal,
  size,
  /**
   * Spell the pair out — «45 минут в день, 5 дней в неделю» — rather than
   * naming the bar. The panel is where the goal is set and the sentence is
   * what says what was set; the plate in the corner of the map has room for
   * three words and gets «Цель на неделю», since what a reader wants from it
   * there is the shape of the bar and not the terms of it.
   */
  detail = false,
  className = '',
}: {
  goal: WeekGoal;
  size: number;
  detail?: boolean;
  className?: string;
}) {
  const { t, count, plural } = useT();

  return (
    <span className={`flex items-center gap-1.5 ${className}`}>
      {/* The name stays quiet even on the day it is made: the news is the word
          after it, and two accents in one line leave the eye nowhere to land. */}
      <span className="flex items-center gap-1.5">
        <Icon name="target" size={size} />
        {detail
          ? t('ui.profile.goal.pair', {
              perDay: count(Math.round((goal.hours * 60) / goal.days), 'minute'),
              days: `${goal.days} ${plural(goal.days, 'day')}`,
            })
          : t('ui.profile.goal.week')}
      </span>
      {goal.met ? (
        <span className="flex items-center gap-1 font-semibold text-accent">
          <Icon name="check" size={size} />
          {t('ui.profile.goal.met')}
        </span>
      ) : null}
    </span>
  );
}

function GoalBar({ goal, className = '' }: { goal: WeekGoal; className?: string }) {
  const { t } = useT();

  /*
   * Both numbers in hours whatever the size of either: «45 минут из 5 часов» is
   * two units in one sentence, and the reader has to convert one of them before
   * the comparison the line exists for can happen.
   *
   * The unit is abbreviated, and that is grammar rather than economy. Russian
   * «из» takes the genitive, where every numeral above one wants «часов» — «из
   * 3 часов» — while the plural rule the rest of the site runs on would agree it
   * with the numeral and write «из 3 часа». «ч» does not decline, so the line is
   * right in every language that writes its own template around it.
   */
  const label = t('ui.profile.goal.of', {
    done: formatHours(goal.done),
    // Rounded like every other hour on these screens. The week is a product of
    // two chosen steps now and lands on «3,75» as readily as on «5».
    goal: formatHours(goal.hours),
  });

  return (
    <ProgressBar
      // Clamped for the bar's own `aria-valuenow`, which has to sit inside its
      // range — «6,6 из 5» is a fine thing to read and not a thing to announce.
      done={Math.min(goal.done, goal.hours)}
      total={goal.hours}
      fill={goal.fraction}
      className={className}
      /*
       * The label keeps counting past the goal. A week of six hours against a
       * target of five is the best week somebody has had, and rounding it down
       * to «5 из 5» would take that away to tidy up an arithmetic that nobody
       * was confused by. Accented once the hours are in: the bar is full and
       * green, and the number beside it should be saying the same thing.
       *
       * The hours rather than the days, which is what «выполнена» above is
       * about. This is the bar's own claim about its own number, and a full
       * green bar beside a quiet grey number would be the same contradiction
       * the other way round: whether the week was the week that was planned is
       * a different sentence, and it is written in words.
       */
      label={goal.hoursMet ? <span className="text-accent">{label}</span> : label}
    />
  );
}

/**
 * The bar with the choosing attached: the panel's copy.
 *
 * The ladders are folded away once a goal is set. It is a decision somebody
 * makes about once, and a permanent strip of buttons under a number reads as a
 * control panel rather than as a week.
 *
 * Two rows, one decision. The minutes are what a day is rated against and the
 * days are what makes a week out of them, and neither is an answer on its own:
 * «45 минут» says nothing about a week and «5 дней» nothing about a day. They
 * are set together and printed together, and the week under them is their
 * product rather than a third thing to choose.
 */
export function WeekGoalRow() {
  const { t } = useT();
  const goal = useWeekGoal();
  const day = useDayGoal();
  const setSetting = useProfile((state) => state.setSetting);
  const [editing, setEditing] = useState(false);

  const chooseMinutes = (minutes: number | null): void => {
    setSetting('dayGoal', minutes);
    // Only the "off" end closes the ladders. Picking a length is half the
    // decision, and folding the days away under the hand that has just chosen
    // minutes is the control deciding it knows what somebody meant.
    if (!minutes) setEditing(false);
  };

  if (!goal && !editing) {
    return (
      <div className="mt-2 border-t border-line pt-2">
        {/* A ghost is a word rather than a plate and carries no layout of its
            own, so the mark in front of it needs one — otherwise the icon
            takes a line to itself. */}
        <Button
          variant="ghost"
          small
          icon="target"
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
      {/*
        With no goal set the heading names what the ladder under it offers, and
        that is a **study day** — the row is «15 м … 120 м», and «Цель на
        неделю» over tens of minutes reads as a target nobody could take
        seriously. It is the study day rather than the day because the goal is
        only ever measured against the days somebody actually studies: a rest
        day does not fail it, it is simply not one of the five.
      */}
      <div className="flex items-baseline gap-2 text-xs text-ink-faint">
        {goal ? <GoalName goal={goal} size={12} detail /> : <span>{t('ui.profile.goal.day')}</span>}
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

      {/*
        The week said in days rather than in hours.
        «2,1 из 3,75 ч» and «3 из 5 дней закрыто» are both true of the same
        week, and only the second says whether the habit is going the way it
        was meant to: five short evenings and one long Sunday come to the same
        number of hours and are not the same week. It is also the one line the
        day's goal buys that nothing else on this screen could print.
      */}
      {goal ? (
        <p className="num text-[11px] text-ink-faint">
          {t('ui.profile.goal.closed', { done: goal.closed, days: goal.days })}
        </p>
      ) : null}

      {editing ? (
        <div className="space-y-1.5">
          <Segmented
            value={String(day?.minutes ?? 0)}
            label={t('ui.profile.goal.day')}
            options={[
              { value: '0', label: t('ui.profile.goal.off') },
              // Short forms — «45 м» — because seven full ones do not fit a
              // phone and the row would scroll past its own options.
              ...DAY_GOALS.map((minutes) => ({
                value: String(minutes),
                label: t('ui.profile.goal.minutes', { n: minutes }),
              })),
            ]}
            onChange={(value) => chooseMinutes(Number(value) || null)}
          />
          {/* The second half appears only once there is a first: days a week
              of nothing a day is a row of buttons that changes no number on
              the screen. */}
          {day ? (
            <Segmented
              value={String(goal?.days ?? 5)}
              label={t('ui.profile.goal.daysAWeek')}
              options={GOAL_DAYS.map((days) => ({
                value: String(days),
                label: String(days),
              }))}
              onChange={(value) => setSetting('goalDays', Number(value))}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
