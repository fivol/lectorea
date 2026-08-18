import { useMemo } from 'react';
import type { DayLog } from '@shared/schema';
import { hoursFromSeconds } from '@/lib/format';
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
  recent: Day[];
  /** This week so far, counted from Monday. */
  week: Week;
};

/** One day of the strip: whether it happened, and how much of it there was. */
export type Day = { day: string; studied: boolean; seconds: number; lectures: number };

/** What has been done since Monday — the unit a week of studying is planned in. */
export type Week = { seconds: number; lectures: number; days: number };

/**
 * How full a day looks in the strip, 0 to 4.
 *
 * The steps are lengths of study rather than counts of anything: counting
 * lectures instead would put a day of six ten-minute explainers above a day of
 * two hours, which is not what either day felt like.
 *
 * **Against the reader's own day where they have set one**, and against a fixed
 * ladder where they have not. The ladder was a number somebody picked for
 * everybody: for a reader whose evening is two lectures every square is the
 * darkest one there is, and for a reader with ten minutes on a train none of
 * them ever leaves the first step — in both cases the strip stops describing
 * the habit and describes the calibration. A share of a chosen day says the
 * one thing a square can usefully say, which is whether that day was the day
 * they meant to have: a start, half of it, made, and more than made.
 *
 * The price is that changing the goal repaints the last four weeks. That is
 * the right way round — it is the reader's own yardstick and nobody else reads
 * this strip — but it is why the fixed ladder stays for the profiles with no
 * goal rather than being replaced by a default one.
 *
 * A day logged with nothing measured still reaches the first step. Days from
 * before the log kept seconds are exactly that, and letting them fall back to
 * the empty square would delete somebody's history the day the site updated.
 */
const DAY_STEPS = [30 * 60, 60 * 60, 2 * 60 * 60];

/** A quarter of the day's goal, half of it, the whole of it, half as much again. */
const GOAL_STEPS = [0.5, 1, 1.5];

export function levelOf(day: Day, goalSeconds?: number | null): 0 | 1 | 2 | 3 | 4 {
  if (!day.studied) return 0;
  const steps = goalSeconds ? GOAL_STEPS.map((share) => share * goalSeconds) : DAY_STEPS;
  return (steps.filter((step) => day.seconds >= step).length + 1) as 1 | 2 | 3 | 4;
}

/** `2026-08-13` → the same day at local midnight. */
export function parseDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, date ?? 1);
}

/**
 * A day, some days later or earlier.
 *
 * Counted in *dates* rather than in milliseconds. Adding `n × 86 400 000` to a
 * local midnight is right in a zone with no daylight saving and wrong twice a
 * year everywhere else: the hour the clocks go back turns midnight plus seven
 * days into 23:00 the evening before, and the string that comes out of it is
 * the wrong day. That is a streak broken on a Sunday somebody studied, and a
 * week of the plan starting on a Sunday. The constructor normalises an
 * out-of-range date itself, so `+ by` on the day of the month is the whole of
 * the arithmetic.
 */
export function shiftDay(day: string, by: number): string {
  const date = parseDay(day);
  return localDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + by));
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
  return shiftDay(day, -((parseDay(day).getDay() + 6) % 7));
}

/** Everything logged from Monday to today, inclusive. */
export function weekOf(days: DayLog[], today: string): Week {
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
  const logged = new Map(days.map((entry) => [entry.day, entry]));
  const strip = (): Day[] => {
    const out: Day[] = [];
    for (let back = window - 1; back >= 0; back -= 1) {
      const day = shiftDay(today, -back);
      const entry = logged.get(day);
      out.push({
        day,
        studied: Boolean(entry),
        seconds: entry?.sec ?? 0,
        lectures: entry?.lectures ?? 0,
      });
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
  let cursor = todayDone ? today : shiftDay(today, -1);
  let streak = 0;
  while (logged.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }

  // The longest run ever: walk the sorted days and break wherever the next one
  // is not the morning after.
  const sorted = [...logged.keys()].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    run = previous && shiftDay(previous, 1) === day ? run + 1 : 1;
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

/**
 * What a day of study can be aimed at, and how many of them a week holds.
 *
 * One decision in two halves — «45 минут, 5 дней в неделю» — from which both
 * numbers the product prints fall out: the day it rates every square against,
 * and the week it fills the bar with. It used to be the week alone, which
 * could rate nothing smaller than itself, and dividing a week by seven to get
 * a day would have handed a five-hour week a target of forty-three minutes on
 * a Sunday it was never meant to include.
 *
 * The minutes start at fifteen because the day worth aiming at is the first
 * one: somebody who has watched nothing is choosing between a quarter of an
 * hour and giving up. Both ladders widen as they go, for the reason a volume
 * knob does.
 */
export { DAY_GOALS, GOAL_DAYS } from '@shared/schema';

/** A goal for the week and how far into it the reader is. */
export type WeekGoal = {
  /** What was aimed at, in hours — the day's goal across the days it is for. */
  hours: number;
  /** What has been done, in the same unit — so the two can be printed together. */
  done: number;
  /** 0..1, never past 1: a bar that overflows is a bar that has stopped meaning anything. */
  fraction: number;
  /**
   * The goal as it was actually set: **the days are made.**
   *
   * A goal here is «45 минут, 5 дней в неделю», and a week that holds four and
   * a half hours in two long Sundays is not the week that was asked for — it is
   * the hours of it without the habit. Counting the hours instead made
   * «выполнена» and «2 из 5 дней закрыто» stand one line apart contradicting
   * each other, which is the sort of pair a reader resolves by believing
   * neither. So the word belongs to the days, and the hours keep the bar.
   */
  met: boolean;
  /**
   * The bar's own reading: the hours are in, whatever shape the days came in.
   *
   * The bar is drawn and labelled in hours, so its number is entitled to say
   * when it has reached its own target — that is a fact about the bar and not
   * a claim about the week.
   */
  hoursMet: boolean;
  /** Days of study the week is meant to hold, and how many of them are made. */
  days: number;
  closed: number;
};

/** A goal for today, which is the half of it a day can be rated against. */
export type DayGoal = {
  /** What was aimed at, in minutes. */
  minutes: number;
  seconds: number;
  /** Behind you today, in seconds. */
  done: number;
  fraction: number;
  met: boolean;
};

/** The pair as it is stored, or nothing — which is what a profile with no goal has. */
function useGoalPair(): { minutes: number; days: number } | null {
  const minutes = useProfile((state) => state.profile.settings.dayGoal);
  const days = useProfile((state) => state.profile.settings.goalDays);
  return useMemo(() => (minutes ? { minutes, days } : null), [minutes, days]);
}

/**
 * The week in force, or nothing.
 *
 * `closed` counts the days of this week that reached the day's goal, which is
 * the statement about a habit that hours cannot make: «3 дня закрыто» and «2,1
 * часа» are both true of the same week and only the first one says whether it
 * is going the way it was meant to.
 */
export function useWeekGoal(): WeekGoal | null {
  const pair = useGoalPair();
  const activity = useActivity();

  return useMemo(() => {
    if (!pair) return null;
    const target = pair.minutes * 60 * pair.days;
    const monday = startOfWeek(activity.recent[activity.recent.length - 1]?.day ?? '');
    const closed = activity.recent.filter(
      (day) => day.day >= monday && day.seconds >= pair.minutes * 60
    ).length;
    return {
      hours: target / 3600,
      done: hoursFromSeconds(activity.week.seconds),
      fraction: Math.min(1, activity.week.seconds / target),
      met: closed >= pair.days,
      hoursMet: activity.week.seconds >= target,
      days: pair.days,
      closed,
    };
  }, [pair, activity]);
}

/** The day in force, or nothing. */
export function useDayGoal(): DayGoal | null {
  const pair = useGoalPair();
  const activity = useActivity();

  return useMemo(() => {
    if (!pair) return null;
    const seconds = pair.minutes * 60;
    // The last square of the strip is today, by construction — see `activityOf`.
    const done = activity.recent[activity.recent.length - 1]?.seconds ?? 0;
    return {
      minutes: pair.minutes,
      seconds,
      done,
      fraction: Math.min(1, done / seconds),
      met: done >= seconds,
    };
  }, [pair, activity]);
}
