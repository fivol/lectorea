import { useMemo, useRef } from 'react';
import type { BuiltPlaylist, Video } from '@shared/schema';
import { shiftDay, startOfWeek, useActivity, useDayGoal, useWeekGoal, weekOf } from './activity';
import { unlocksOf, useCatalog } from './catalog';
import { clamp } from './format';
import type { PlaylistProgress } from './progress';
import { localDay, useProfile } from '@/store/profile';

/**
 * The five mechanics that make a long recording finishable.
 *
 * Half the catalogue's substantial recordings are objects nobody can hold in
 * their head: 2732 of them run to 20 lectures or more, 1707 to 20 hours or
 * more, and the largest is 515 lectures. Everything the site counted before
 * this was either *global* — the streak, the week, the strip of days — or
 * about *the whole object* — the percentage, the course status. Between "one
 * lecture" and "82 hours" there was nothing, and one lecture of sixty moves a
 * bar by 1.7%: an evening of work that leaves no mark is an evening people do
 * not repeat.
 *
 * Each mechanic is one flag here and one tag at every place it shows:
 *
 * | Flag | Tag | What it is | Where it renders |
 * |---|---|---|---|
 * | `today` | `[game:today]` | the session said in numbers, and what is left of the day's goal | wherever a press answers it: the front page's card, the course panel, the recording's sheet, the player's progress header |
 * | `schedule` | `[game:schedule]` | the lectures still ahead dealt into calendar weeks of the reader's goal | the lecture list |
 * | `audience` | `[game:audience]` | where the rest of the audience stopped, and how far past them you are | the lecture list, and a line over it |
 * | `finish` | `[game:finish]` | the end of a recording as an event, and the courses it opened | the foot of the player sidebar |
 * | `weeks` | `[game:weeks]` | what this recording costs at the reader's own pace | the recording sheet |
 *
 * ```bash
 * grep -rn "game:schedule" src scripts shared
 * ```
 *
 * finds every site of one of them, and `false` here switches it off whole —
 * the components below all return `null` on their own flag, so a call site
 * needs no condition of its own. These are switches for whoever is working on
 * this, not settings: nothing in the profile reads them, and a reader never
 * sees them.
 *
 * Two rules they are all written against, both from `docs/agents/practices.md`:
 * **a number printed here is a fact about the rows on screen**, never an
 * inference about the course they came from — which is why a week of the plan
 * is labelled with the dates it covers and what the rows under it come to, and
 * never with a chapter read off somebody's titles ([`weeksOf`](#)) — and
 * **nothing here hands the reader a debt they did not take on**: each of them
 * is a report of something that already happened, or silence.
 *
 * The plan is the one that looks like an exception and is not. It is a
 * forecast rather than a report, but every figure in it is the reader's own
 * goal divided by rows they can see, and without a goal there is nothing to
 * divide and it draws nothing at all.
 */
export const GAME = {
  today: true,
  schedule: true,
  audience: true,
  finish: true,
  weeks: true,
} as const;

/* ─────────────────────────────  1 · today  ──────────────────────────────
 * [game:today]
 *
 * The week's goal already exists and lives in the profile and on the front
 * page — which is to say, nowhere near the moment the decision it is about
 * actually gets made. Nobody decides whether to watch one more lecture while
 * looking at the map; they decide it on the titles of the one that just
 * finished. So the two numbers travel to the player: what today came to, and
 * what is left of it.
 *
 * And to every other place a press answers it: the front page's card, the
 * course panel's continue block, and the recording's sheet before play — which
 * is where the *other* decision is made, not "one more lecture" but "anything
 * at all this evening". Both are decisions about the next twenty minutes,
 * which is what the day is the unit of; the week says how it is going and asks
 * for nothing. The line is one component in four homes rather than four lines
 * that have to be kept in step, so no two screens can disagree about the same
 * afternoon (`TodayLine`).
 *
 * Both are already in `profile.days` — see `credit()` in the store, which is
 * what makes them trustworthy: the log is written by the acts that mean
 * somebody was working, and by no others.
 */

export type Today = { seconds: number; lectures: number };

/** What has been logged against today, which is what the day's strip square is worth. */
export function useToday(): Today {
  const days = useProfile((state) => state.profile.days);
  return useMemo(() => {
    const today = localDay();
    // The log is sorted and today is at the tail on any profile written here;
    // the scan is for one merged from another machine, which can arrive with
    // today somewhere in the middle. It is bounded by `DAYS_LIMIT`.
    const entry = days.find((day) => day.day === today);
    return { seconds: entry?.sec ?? 0, lectures: entry?.lectures ?? 0 };
  }, [days]);
}

export type DayLeft = {
  /** Still to be spent today, in seconds. Zero once the day is made. */
  seconds: number;
  /** What today was aimed at, so the line can print «25 из 45 минут». */
  target: number;
  met: boolean;
  /**
   * And whether the *week* is already made — its days closed, not its hours.
   *
   * A goal of «45 минут, 5 дней» is a week with two days off in it. Once the
   * five are behind the reader, a sixth is not owed, and a line asking for one
   * is the site inventing a target nobody set: a rest day is a day this goal
   * was written to allow. So the ask goes quiet and the news stays.
   */
  weekMet: boolean;
  /** Days of the week made so far, out of how many were meant — only once met. */
  closed: number;
  days: number;
};

/**
 * What is left of today's goal, or nothing at all.
 *
 * Nothing at all is the answer for a reader who never set a goal, and that is
 * the point: an unasked-for target is a debt, and the argument against handing
 * one out is the same one the path bar and `WeekGoal` are written against.
 *
 * The **day** rather than the week, which is what this line used to carry. A
 * week's remainder read from inside a lecture is a number about a plan; the
 * day's is a number about the next twenty minutes, and the next twenty minutes
 * are what the reader is deciding on. The week has not gone anywhere — it is
 * the bar on the front page and in the panel, where looking back is what the
 * screen is for.
 */
export function useDayLeft(): DayLeft | null {
  const day = useDayGoal();
  const week = useWeekGoal();
  return useMemo(() => {
    if (!day || !week) return null;
    return {
      seconds: Math.max(0, day.seconds - day.done),
      target: day.seconds,
      met: day.met,
      weekMet: week.met,
      closed: week.closed,
      days: week.days,
    };
  }, [day, week]);
}

/* ────────────────────────────  2 · schedule  ────────────────────────────
 * [game:schedule]
 *
 * A recording of sixty lectures is one object with one finish line, and the
 * finish line is eighty hours away. Laid out on the reader's own calendar it
 * is four rows that are this week's, four under them that are next week's, and
 * a date on everything after that — which is the form the question actually
 * comes in. Nobody asks how much of a course is left; they ask what they are
 * doing on Thursday.
 *
 * The other half of `[game:weeks]`, and the same division read the other way
 * round: that one says how long the whole recording will take («≈5 недель ·
 * примерно до 15 декабря»), this one says which rows fall where.
 *
 * **It replaced stages of about three hours**, and both of that mechanic's
 * troubles came from the unit. A stage had to be named, and it could not be:
 * of the 2732 recordings with twenty lectures or more only 170 — 6% — carry a
 * section marker in their titles that can be parsed at all, so «Веха 2 из 15»
 * was our own arithmetic printed in the voice of somebody's syllabus. And
 * three hours is not a unit anybody lives in. A week is, and the reader has
 * already said what theirs holds — «45 минут, 5 дней» — which makes the
 * division here the only one on the screen that is *theirs* rather than ours.
 *
 * Which is also why the whole mechanic is silent without a goal. There is
 * deliberately no measured fallback of the kind `useWeekPace` has: a pace read
 * off the last four weeks is an honest thing to *report* and a poor thing to
 * draw a calendar from, because a calendar drawn from it hands the reader
 * dates nobody agreed to and moves them the week they take off. A plan is a
 * division of a goal somebody set, or it is nothing.
 */

/**
 * How far ahead the rows are dated.
 *
 * A quarter of a year, which is where a date on a plan stops being information
 * — `planFor` gives up at about the same distance and for the same reason.
 * Without the cap a 515-lecture recording at four hours a week puts a hundred
 * and thirty rules through one list, each of them a promise about next spring;
 * with it the plan runs out and the rest of the list is a list again.
 */
export const SCHEDULE_MAX_WEEKS = 12;

/**
 * The step the week's spent time is read at.
 *
 * What is left of this week's goal is one of the two inputs, and the player
 * writes the profile every five seconds — so the exact figure re-cuts a
 * five-hundred-row list twelve times a minute under the reader's hand. Rounded
 * down to five minutes it is re-cut at most twelve times an hour, at the price
 * of a boundary that can sit up to five minutes of budget behind where the
 * exact figure would have put it.
 */
export const SCHEDULE_STEP_SECONDS = 300;

/** One calendar week of the plan, and the run of rows that falls in it. */
export type PlanWeek = {
  /** 0 is the week the reader is standing in, 1 the one after it. */
  index: number;
  /** Its Monday and its Sunday, as local day strings. */
  from: string;
  to: string;
  /** The row it opens at. It runs to the row before the next week's. */
  at: number;
  /** What is still ahead under it, and what those rows come to. */
  lectures: number;
  seconds: number;
};

/**
 * Deal the lectures still ahead into calendar weeks, or refuse to.
 *
 * Three rules, and the first is the reason this is not a progress bar cut into
 * pieces:
 *
 * **Only what is ahead is in the plan.** A lecture behind the reader costs
 * nothing and starts nothing, so the rows above the first unticked one carry
 * no rule at all — they are last month's, and «Текущая неделя» over them would
 * be a claim about the past. A ticked row in the middle of a week simply sits
 * under whatever rule is open and adds nothing to it.
 *
 * **Whole lectures, whatever the playhead says.** A lecture half watched still
 * costs its full length. The plan is a list of rows to sit down to; one that
 * re-cut itself as the frame reported its position would be a plan nobody
 * could read twice, and half a lecture is not half an evening.
 *
 * **A week takes what fits, and never fewer than one.** The lecture that would
 * overflow opens the next week instead — but a week that has nothing yet takes
 * it regardless, because a rule with no rows under it says nothing and an
 * eighty-minute lecture against a forty-five-minute day would produce an
 * endless run of them.
 *
 * The week in hand gets what is left of the goal rather than the whole of it,
 * which is the point of counting it at all: three hours in since Monday, this
 * week is what the remaining forty-five minutes reach. Once the goal is made
 * the week in hand takes nothing and the plan opens on «Следующая неделя» —
 * the mechanic's one statement about what has been done, made by going quiet
 * rather than by asking for an evening the goal never asked for.
 *
 * **And a remainder is never overflowed**, which is where the two rules above
 * meet. A week that has been studied into is not an empty week: its budget is
 * the tail of an evening somebody already had, so a lecture too long for it
 * opens the next week rather than being dropped on top — the same answer the
 * spent goal gets, arrived at before the goal is quite spent. The rule that
 * takes a lecture whatever its length survives where it is needed: a week
 * nobody has studied into yet, where refusing would print rules with nothing
 * under them for as long as the lectures are longer than the goal.
 */
export function weeksOf(
  videos: Video[],
  done: (index: number) => boolean,
  weekSeconds: number,
  spentSeconds: number,
  today: string
): PlanWeek[] {
  if (weekSeconds <= 0 || !videos.length) return [];

  const weeks: PlanWeek[] = [];
  const monday = startOfWeek(today);
  let index = 0;
  let budget = weekSeconds - spentSeconds;
  let open: PlanWeek | null = null;

  for (const [row, video] of videos.entries()) {
    if (done(row)) continue;
    if (open && open.seconds + video.seconds > budget) {
      weeks.push(open);
      open = null;
      index += 1;
      budget = weekSeconds;
    }
    if (!open) {
      /*
       * The week in hand, with time already spent into it, is the one week
       * that does not take a lecture too long for its budget: what is left of
       * a goal is not an evening to overflow. Skipping to the next week here
       * also covers the goal being spent outright — the remainder is then
       * nought or less, and nothing fits it.
       */
      if (index === 0 && spentSeconds > 0 && video.seconds > budget) {
        index = 1;
        budget = weekSeconds;
      }
      if (weeks.length >= SCHEDULE_MAX_WEEKS) break;
      const from = shiftDay(monday, index * 7);
      open = { index, from, to: shiftDay(from, 6), at: row, lectures: 0, seconds: 0 };
    }
    open.lectures += 1;
    open.seconds += video.seconds;
  }
  if (open) weeks.push(open);

  // One week is not a plan. It says everything left fits in the week in hand,
  // which is a fact about the recording the bar over the list already carries.
  return weeks.length < 2 ? [] : weeks;
}

/**
 * The plan for one recording, keyed by the row each week opens at.
 *
 * Every input is pulled out of the store as a **primitive**, and that is the
 * whole design of this hook. The list under it runs to five hundred rows and
 * each of them is subscribed to its own tick; a selector here returning an
 * object would hand all five hundred a new parent every five seconds, which is
 * the same trap the stage headers were written around before. So: two settings,
 * a rounded number of seconds, and a string of ones and noughts for which rows
 * are behind the reader. Strings compare by value, so the list is left alone
 * until a tick actually changes.
 *
 * And the plan itself is cut once a visit — the reason is on the cut below.
 * The primitives keep being read after it, because a store snapshot has to
 * answer the same for one store state however often it is asked; what stops is
 * the cutting, not the reading.
 */
export function useSchedule(videos: Video[], complete: boolean): Map<number, PlanWeek> {
  const minutes = useProfile((state) => state.profile.settings.dayGoal);
  const days = useProfile((state) => state.profile.settings.goalDays);
  const spent = useProfile((state) => {
    const week = weekOf(state.profile.days, localDay());
    return Math.floor(week.seconds / SCHEDULE_STEP_SECONDS) * SCHEDULE_STEP_SECONDS;
  });

  /*
   * **Cut once when the reader arrives, and left alone for the visit.**
   *
   * Both of the moving inputs move under the reader's own hand: `spent` grows a
   * step at a time while a lecture plays, and `done` flips the moment one ends.
   * Every move of either walks «Текущая неделя» *down* the list — the remainder
   * shrinks, so the rule loses a lecture off its end; a row is ticked, so the
   * rule opens a row further on. The reader who sat down to «2 лекции · 17
   * минут» watches the rule slide past the row they were reaching for, and the
   * week they had just decided to have get shorter as they have it. A plan that
   * re-cuts itself while it is being read is not a plan — and this is the same
   * trouble `SCHEDULE_STEP_SECONDS` was rounding the corners off, at a place
   * where the answer turns out to be not to move at all.
   *
   * So the cut is keyed by what means *a different plan* — another recording,
   * and the goal, which the reader can change from the panel this is drawn in
   * and which is a deliberate act wanting an immediate answer. Not by the two
   * that only mean the evening is going. The next visit to the list cuts again,
   * from where the reader is standing then.
   */
  const cut = useRef<{ key: string; plan: Map<number, PlanWeek> } | null>(null);
  const key = `${videos[0]?.id ?? ''}:${videos.length}:${complete}:${minutes}:${days}`;

  /*
   * Read on every write even though only the cutting render uses it, and that
   * is deliberate: this is a `useSyncExternalStore` snapshot, and a selector
   * that answered '' once the plan was cut would return two different values
   * for one store state — which under `StrictMode`'s double render is exactly
   * the "getSnapshot should be cached" trap. The saving would be five hundred
   * lookups on a write; the price is a hook that can disagree with itself.
   */
  const done = useProfile((state) => {
    // Nothing to divide and nothing to divide it into: the string is not worth
    // building on every write the player makes for a reader who set no goal.
    if (complete || !minutes) return '';
    let rows = '';
    for (const video of videos) rows += state.profile.videos[video.id]?.done ? '1' : '0';
    return rows;
  });

  let plan = cut.current?.key === key ? cut.current.plan : null;
  if (!plan) {
    plan = new Map<number, PlanWeek>();
    if (GAME.schedule && !complete && minutes && days) {
      const weeks = weeksOf(
        videos,
        (row) => done[row] === '1',
        minutes * 60 * days,
        spent,
        localDay()
      );
      for (const week of weeks) plan.set(week.at, week);
    }
    cut.current = { key, plan };
  }
  return plan;
}

/* ────────────────────────────  3 · audience  ────────────────────────────
 * [game:audience]
 *
 * The one thing here nobody else could build. The catalogue already prints
 * «досматриваемость 33%» as a fact about a recording; the same numbers, read
 * per lecture, say where the reader is standing relative to everybody who
 * started it — which turns a solitary eighty-hour slog into a position in a
 * real crowd, with no account, no server and nobody being tracked.
 *
 * `playlist.audience` is written by `08-build.ts` and is the share of the first
 * lectures' views that survives to each one, 0..100, as a running minimum so
 * that it only ever falls: "could have got this far" is not a quantity that
 * grows. It is present **only where the view curve is `series`** — the same
 * gate `measuredRetention` applies, and for the same reason: on a subject
 * bucket entered from search the ratio can be computed and means nothing. That
 * covers 1602 of the 2732 long recordings.
 *
 * Views are not people, and nothing here says they are: the wording throughout
 * is a share of views, which is what `docs/rating.md` already established as
 * the honest form of this number.
 */

/** Below this the line says nothing worth the room it takes. */
const AUDIENCE_MIN_SHARE = 5;

/** How far into the recording the reader has got, as an unbroken run from the start. */
export function frontOf(progress: PlaylistProgress): number {
  if (progress.complete) return progress.total - 1;
  return (progress.next?.index ?? 0) - 1;
}

/**
 * The share of this recording's audience the reader is now past, or nothing.
 *
 * Nothing on the first lecture, where the answer is zero by construction and a
 * «дальше, чем 0%» is a way of telling somebody they have not started.
 */
export function audiencePassed(playlist: BuiltPlaylist, progress: PlaylistProgress): number | null {
  const curve = playlist.audience;
  if (!curve?.length) return null;
  const front = frontOf(progress);
  if (front < 1) return null;
  const at = curve[Math.min(front, curve.length - 1)];
  if (at === undefined) return null;
  const passed = Math.round(100 - at);
  return passed >= AUDIENCE_MIN_SHARE ? passed : null;
}

/* ─────────────────────────────  4 · finish  ─────────────────────────────
 * [game:finish]
 *
 * Sixty lectures used to end the way one lecture ends: a checkbox goes green.
 * The course was promoted behind the reader's back with a line offering to
 * undo it, which is the most that has ever been said about finishing eighty
 * hours of work.
 *
 * What the end is worth saying with is not a badge — the catalogue cannot
 * honestly certify anything, and a shelf of trophies is the same monument the
 * front page already refuses to build. It is the graph: this catalogue's whole
 * claim is that courses come in an order, so finishing one **opens** the ones
 * standing on it. That reward is not invented, it is read off `deps`.
 */

/** Under this the end of a recording is not an event, and saying so is noise. */
export const FINISH_MIN_LECTURES = 8;

/**
 * Courses whose every prerequisite is now behind the reader, and which are not
 * themselves done.
 *
 * The immediate dependants only — `unlocksOf` already argues why the forward
 * closure is a wall of chips nobody reads — and filtered to what the catalogue
 * will actually draw, since a course can be in the graph and hidden from it.
 */
export function useUnlocked(courseId: string): string[] {
  const catalog = useCatalog();
  const courses = useProfile((state) => state.profile.courses);

  return useMemo(() => {
    const done = (id: string) => courses[id]?.status === 'done';
    if (!done(courseId)) return [];
    return unlocksOf(catalog, courseId)
      .map(({ id }) => id)
      .filter((id) => {
        const course = catalog.courseById.get(id);
        if (!course || course.hidden || done(id)) return false;
        return course.deps.every(done);
      });
  }, [catalog, courses, courseId]);
}

/* ──────────────────────────────  5 · weeks  ─────────────────────────────
 * [game:weeks]
 *
 * «82 ч» answers how big the thing is and not the question a reader actually
 * has in front of it, which is whether it fits in their life. Divided by what
 * they actually study in a week it becomes a number of weeks and a date, and
 * both are arithmetic over figures the site already holds.
 *
 * The pace comes from the goal where there is one and from the **measured**
 * last four weeks where there is not — which is the half that matters, because
 * most readers never set a goal. A measured pace is a report and needs no
 * opt-in; it is also why the sentence says out loud where its number came
 * from, per the rule that a derived figure carries its rule wherever it is
 * printed.
 */

export type Pace = { secondsPerWeek: number; source: 'goal' | 'measured' };

/** Days of study in the last four weeks before an average over them is a pace at all. */
const PACE_MIN_DAYS = 3;

export function useWeekPace(): Pace | null {
  const goal = useWeekGoal();
  const activity = useActivity();

  return useMemo(() => {
    if (goal) return { secondsPerWeek: goal.hours * 3600, source: 'goal' };
    const days = activity.recent;
    const studied = days.filter((day) => day.studied).length;
    if (studied < PACE_MIN_DAYS) return null;
    const seconds = days.reduce((sum, day) => sum + day.seconds, 0);
    if (seconds <= 0) return null;
    // The window is four weeks by construction (`ACTIVITY_WINDOW`), so the
    // divisor is the window in weeks rather than the days that happen to be in
    // it: a pace counted only over the days somebody studied is not a pace,
    // it is how fast they go while going.
    return { secondsPerWeek: (seconds / days.length) * 7, source: 'measured' };
  }, [goal, activity.recent]);
}

export type Plan = {
  weeks: number;
  /** When it lands, or null where the horizon makes a date a joke. */
  date: Date | null;
  pace: Pace;
};

/** How long a plan may run before a date on it stops being information. */
const PLAN_MAX_WEEKS = 52;

/**
 * The same division, said in whichever unit the answer is actually in.
 *
 * «осталось ≈119 ч» is printed in four places — the path in the panel, the
 * goals bar, a goal card, a course being studied — and hours are the one unit
 * in which none of those is an answer: nobody knows whether 119 hours is a
 * fortnight or a year without knowing how they study. Divided by the reader's
 * own pace it becomes a horizon, and the unit follows the size of it, because
 * «≈159 учебных дней» and «≈0,2 месяца» are both arithmetically correct and
 * neither is something a person says.
 *
 * Study days rather than days, and only where a day's goal exists to divide
 * by: a rest day is not a day this counts, which is the whole reason the goal
 * is stored as a day and a number of days.
 */
export type Horizon =
  | { unit: 'day' | 'week' | 'month'; value: number }
  /** Past the point where a number is worth printing — see `HORIZON_MAX_MONTHS`. */
  | { unit: 'over' };

/** A fortnight of weeks is where days stop being countable. */
const HORIZON_DAY_WEEKS = 2;
/** And where weeks do. Ten of them is «два с половиной месяца» said the long way. */
const HORIZON_WEEK_LIMIT = 8;
const WEEKS_IN_MONTH = 4.345;
/** Beyond two years the figure says «not soon» and nothing else, so it says that. */
const HORIZON_MAX_MONTHS = 24;

export function horizonFor(
  remainingSeconds: number,
  pace: Pace | null,
  dayGoalSeconds: number | null
): Horizon | null {
  if (!pace || remainingSeconds <= 0 || pace.secondsPerWeek <= 0) return null;
  const weeks = remainingSeconds / pace.secondsPerWeek;

  if (dayGoalSeconds && weeks <= HORIZON_DAY_WEEKS) {
    return { unit: 'day', value: Math.max(1, Math.ceil(remainingSeconds / dayGoalSeconds)) };
  }
  if (weeks <= HORIZON_WEEK_LIMIT) return { unit: 'week', value: Math.max(1, Math.ceil(weeks)) };

  const months = Math.round(weeks / WEEKS_IN_MONTH);
  return months > HORIZON_MAX_MONTHS ? { unit: 'over' } : { unit: 'month', value: months };
}

/**
 * What is left of a recording, in weeks of the reader's own pace.
 *
 * Null under two weeks: «≈1 неделя» over a recording somebody is halfway
 * through is arithmetic performed for its own sake.
 */
export function planFor(remainingSeconds: number, pace: Pace | null): Plan | null {
  if (!pace || remainingSeconds <= 0 || pace.secondsPerWeek <= 0) return null;
  const weeks = Math.ceil(remainingSeconds / pace.secondsPerWeek);
  if (weeks < 2) return null;
  const date =
    weeks > PLAN_MAX_WEEKS ? null : new Date(Date.now() + weeks * 7 * 24 * 3600 * 1000);
  return { weeks: Math.min(weeks, PLAN_MAX_WEEKS + 1), date, pace };
}

/** Shared by the marks down the lecture list: a bar that never quite vanishes. */
export function audienceWidth(reach: number): number {
  return clamp(reach, 6, 100);
}
