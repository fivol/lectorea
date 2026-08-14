import { useMemo, type ReactNode } from 'react';
import { useT, type Translator } from '@/i18n';
import { ACTIVITY_WINDOW, levelOf, startOfWeek, useActivity, type Day } from '@/lib/activity';
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
 * Four weeks of days, one square each, shaded by how much of each there was.
 *
 * The only thing in the profile that shows a shape rather than a number: what a
 * reader wants to know about their own habit is whether it has holes in it, and
 * twenty-eight squares answer that at a glance in a way «12 дней» never can.
 * Shading them turns the same strip into a second answer — a fortnight of ten
 * minutes and a fortnight of evenings are not the same habit, and until the log
 * kept seconds there was no way to draw the difference.
 *
 * Mondays are given room in front of them, so the run of days breaks into the
 * weeks it is actually made of. Without the seams the strip is twenty-eight
 * days in a line and "three good days" says nothing about *which* three; with
 * them the last group is this week so far, standing directly over the line that
 * says what it came to. The seams fall where the calendar puts them rather than
 * every seventh square — the window ends today, so both ends are part-weeks,
 * and that is the truth about a month that does not start on a Monday.
 *
 * The week in hand is spelled out underneath. It is the last group said in
 * numbers, which is the pair of figures the front page is counted from, and a
 * picture is a poor place to read «2,2 часа» off.
 */
function ActivityStrip() {
  const { t, count, span, lang } = useT();
  const activity = useActivity();
  const week = activity.week;

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
      {/* One row rather than a row of groups: every square is `flex-1` of the
          same container, so they all come out the same width whatever the
          seams do. Grouping would have to hand each week a share of the row
          and would land on weeks of subtly different squares. */}
      <div className="flex gap-[4px]">
        {activity.recent.map((day, index) => (
          <span
            key={day.day}
            // Midday, so that formatting it in the reader's own zone cannot
            // walk the date back to the day before.
            title={dayTitle(day, formatDate(`${day.day}T12:00`, lang), span, count)}
            data-level={levelOf(day)}
            className={`day-cell h-4 flex-1 rounded-[2px] ${
              // The seam: a Monday carries the week's gap in front of it, and
              // the first square never does — a strip that opens with a gap
              // reads as a missing day.
              startOfWeek(day.day) === day.day && index > 0 ? 'ml-[7px]' : ''
            } ${
              // Today is the last square, and it is the one worth finding: a run
              // is a thing you keep, and keeping it is about today.
              index === activity.recent.length - 1 && !day.studied
                ? 'ring-1 ring-inset ring-line-strong'
                : ''
            }`}
          />
        ))}
      </div>
      {/* Wrapping rather than truncating: on a phone the two of them do not fit
          on one line, and the half of the pair that would be cut is the one
          worth reading. The legend goes under instead, still to the right. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
        <span className="num">
          {t('ui.profile.stats.thisWeek', {
            time: span(week.seconds).text,
            lectures: count(week.lectures, 'lecture'),
          })}
        </span>
        {/* What the shading means, in the only form that fits: the ramp itself.
            A square that is darker than its neighbour is not self-explanatory
            the way a filled one was. */}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {t('ui.profile.stats.less')}
          {[1, 2, 3, 4].map((level) => (
            <span key={level} data-level={level} className="day-cell h-2.5 w-2.5 rounded-[2px]" />
          ))}
          {t('ui.profile.stats.more')}
        </span>
      </div>
    </div>
  );
}

/** «14 августа 2026 — 2,2 часа · 3 лекции», with whatever part of it is true. */
function dayTitle(
  day: Day,
  date: string,
  span: Translator['span'],
  count: Translator['count']
): string {
  const parts: string[] = [];
  if (day.seconds) parts.push(span(day.seconds).text);
  if (day.lectures) parts.push(count(day.lectures, 'lecture'));
  return parts.length ? `${date} — ${parts.join(' · ')}` : date;
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
