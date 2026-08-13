import { useMemo } from 'react';
import { localDay, useProfile } from '@/store/profile';

/**
 * The habit, read off the log of days in the profile.
 *
 * The one number here that is about the future rather than the past: hours and
 * lectures say what has been done, and a run of days says whether it is still
 * happening. Everything is computed from `profile.days` and nothing else — see
 * the field's own note for why no other timestamp in the profile can answer
 * this.
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
};

const DAY = 86_400_000;

/** `2026-08-13` → the same day at local midnight. */
function parseDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, date ?? 1);
}

function shift(day: string, by: number): string {
  return localDay(new Date(parseDay(day).getTime() + by * DAY));
}

export function activityOf(days: string[], today: string, window: number): Activity {
  const set = new Set(days);
  const strip = (): Activity['recent'] => {
    const out: Activity['recent'] = [];
    for (let back = window - 1; back >= 0; back -= 1) {
      const day = shift(today, -back);
      out.push({ day, studied: set.has(day) });
    }
    return out;
  };

  if (!set.size) return { streak: 0, best: 0, total: 0, recent: strip() };

  /*
   * A day is not lost until it is over.
   *
   * Counting back from today alone would show a three-week run as broken every
   * morning until the reader had studied again, which is both wrong and the
   * opposite of encouraging. So the run may end yesterday; it is only on the
   * day after that that it is genuinely over.
   */
  const todayDone = set.has(today);
  let cursor = todayDone ? today : shift(today, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = shift(cursor, -1);
  }

  // The longest run ever: walk the sorted days and break wherever the next one
  // is not the morning after.
  const sorted = [...set].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    run = previous && shift(previous, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    previous = day;
  }

  return { streak, best, total: set.size, recent: strip() };
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
