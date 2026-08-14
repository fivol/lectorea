import { useMemo } from 'react';
import type { DayLog } from '@shared/schema';
import { localDay, useProfile } from '@/store/profile';

/**
 * The habit, read off the log of days in the profile.
 *
 * The numbers here that are about now rather than about everything: a run of
 * days says whether it is still happening, and the week says how much of it
 * there has been since Monday. Everything is computed from `profile.days` and
 * nothing else — see the field's own note for why no other timestamp in the
 * profile can answer any of it.
 */

export type Activity = {
  /** Days in a row, ending today or yesterday. */
  streak: number;
  /** The longest run there has ever been. */
  best: number;
  /** Days of study in total. */
  total: number;
  /** The last `window` days, oldest first — today is the last of them. */
  recent: Array<{ day: string; studied: boolean }>;
  /** This week so far, counted from Monday. */
  week: Week;
};

/** What has been done since Monday — the unit a week of studying is planned in. */
export type Week = { seconds: number; lectures: number; days: number };

const DAY = 86_400_000;

/** `2026-08-13` → the same day at local midnight. */
function parseDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, date ?? 1);
}

function shift(day: string, by: number): string {
  return localDay(new Date(parseDay(day).getTime() + by * DAY));
}

/**
 * The Monday of the week a day falls in.
 *
 * Monday rather than Sunday because the week people plan their studying in is
 * the working one, and because a Sunday evening's lecture belongs with the
 * weekend it was part of rather than opening the week ahead. JavaScript numbers
 * Sunday zero, so the offset is rotated before it is used.
 */
export function startOfWeek(day: string): string {
  return shift(day, -((parseDay(day).getDay() + 6) % 7));
}

/** Everything logged from Monday to today, inclusive. */
function weekOf(days: DayLog[], today: string): Week {
  const monday = startOfWeek(today);
  const week: Week = { seconds: 0, lectures: 0, days: 0 };
  for (const entry of days) {
    // Plain string comparison: ISO dates sort as dates. A day *after* today is
    // a profile written in another time zone and is not this week's business.
    if (entry.day < monday || entry.day > today) continue;
    week.seconds += entry.sec;
    week.lectures += entry.lectures;
    week.days += 1;
  }
  return week;
}

export function activityOf(days: DayLog[], today: string, window: number): Activity {
  const logged = new Set(days.map((entry) => entry.day));
  const strip = (): Activity['recent'] => {
    const out: Activity['recent'] = [];
    for (let back = window - 1; back >= 0; back -= 1) {
      const day = shift(today, -back);
      out.push({ day, studied: logged.has(day) });
    }
    return out;
  };

  const week = weekOf(days, today);
  if (!logged.size) return { streak: 0, best: 0, total: 0, recent: strip(), week };

  /*
   * A day is not lost until it is over.
   *
   * Counting back from today alone would show a three-week run as broken every
   * morning until the reader had studied again, which is both wrong and the
   * opposite of encouraging. So the run may end yesterday; it is only on the
   * day after that that it is genuinely over.
   */
  const todayDone = logged.has(today);
  let cursor = todayDone ? today : shift(today, -1);
  let streak = 0;
  while (logged.has(cursor)) {
    streak += 1;
    cursor = shift(cursor, -1);
  }

  // The longest run ever: walk the sorted days and break wherever the next one
  // is not the morning after.
  const sorted = [...logged].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    run = previous && shift(previous, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }

  return { streak, best, total: logged.size, recent: strip(), week };
}

/** The last four weeks is a month of habit — long enough to show one, short enough to fit a phone. */
export const ACTIVITY_WINDOW = 28;

export function useActivity(window = ACTIVITY_WINDOW): Activity {
  const days = useProfile((state) => state.profile.days);
  // `localDay()` is read once per change of the log rather than per render: the
  // date only matters to the day, and a value that changes on its own would
  // make this hook's result unstable for no reason.
  return useMemo(() => activityOf(days, localDay(), window), [days, window]);
}
