import { useMemo } from 'react';
import type { BuiltPlaylist, Profile, Video } from '@shared/schema';
import { useActivity, useDayGoal, useWeekGoal } from './activity';
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
 * | `milestones` | `[game:milestones]` | a long recording cut into stages of about three hours | the lecture list, and a line over it |
 * | `audience` | `[game:audience]` | where the rest of the audience stopped, and how far past them you are | the lecture list, and a line over it |
 * | `finish` | `[game:finish]` | the end of a recording as an event, and the courses it opened | the foot of the player sidebar |
 * | `weeks` | `[game:weeks]` | what this recording costs at the reader's own pace | the recording sheet |
 *
 * ```bash
 * grep -rn "game:milestones" src scripts shared
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
 * inference about the course they came from — which is why a stage is not
 * called «Глава 2» ([`segmentsOf`](#)) — and **nothing here hands the reader a
 * debt they did not take on**: every one of them is a report of something that
 * already happened, or silence.
 */
export const GAME = {
  today: true,
  milestones: true,
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

/* ───────────────────────────  2 · milestones  ───────────────────────────
 * [game:milestones]
 *
 * A recording of sixty lectures is one object with one finish line, and the
 * finish line is eighty hours away. Cut into stages of about three hours it is
 * twenty-seven finish lines, the nearest of them tonight.
 *
 * A stage is deliberately **unnamed**. Naming one «Глава 2» would be a claim
 * about somebody else's course, and the data does not support it: of the 2732
 * recordings with twenty lectures or more, only 170 — 6% — carry a section
 * marker in their titles that can be parsed at all (`§ N`, `week N`,
 * `chapter N`, `N.M`). Chapters read off titles are not a mechanism, they are
 * a coincidence that holds for one recording in sixteen. What a stage *is* is
 * a fact about the rows it covers: these five lectures, four point two hours —
 * which is printable, by the rule in `practices.md`.
 */

/** About two evenings. Long enough to be an achievement, short enough to be tonight's. */
export const MILESTONE_SECONDS = 3 * 3600;
/** Bounds in lectures, so neither ten-minute nor three-hour lectures make a silly stage. */
export const MILESTONE_MIN = 3;
export const MILESTONE_MAX = 8;
/**
 * And a ceiling on how many stages a recording may be cut into.
 *
 * The lecture cap above is the one that goes wrong at scale, because it is the
 * one that fires when lectures are *short*. «College Algebra» is 2462 clips
 * of thirty-five seconds inside 24 hours: eight of them never reach three
 * hours, so the cap closed every stage and the list came out with 308 rules
 * through it, each over five minutes of material. 119 recordings did this.
 *
 * So the walk is run again with a wider cap when it overflows — a stage of a
 * recording like that is a hundred clips, and the honest reading of the number
 * beside it («124 лекции · 1,2 часа») is still what the rows come to.
 */
export const MILESTONE_MAX_STAGES = 20;
/**
 * Under this a recording is its own milestone and cutting it up is noise: the
 * mechanic is for the long ones, and a twelve-lecture course already shows its
 * whole self in one screen of list.
 */
export const MILESTONE_MIN_LECTURES = 12;

/** A run of consecutive lectures that is meant to be one sitting or two. */
export type Segment = {
  /** 1-based, for the reader. */
  index: number;
  total: number;
  /** Inclusive lecture indexes, 0-based. */
  from: number;
  to: number;
  seconds: number;
};

/**
 * Cut a recording into stages, or refuse to.
 *
 * Refuses on three grounds, each of which would make the cut a lie or a
 * nuisance: too few lectures, too short to hold two stages, or no lengths in
 * the shard to measure with. An empty array is the honest answer and every
 * caller treats it as "this recording has no stages", not as an error.
 */
export function segmentsOf(videos: Video[]): Segment[] {
  if (videos.length < MILESTONE_MIN_LECTURES) return [];
  const total = videos.reduce((sum, video) => sum + video.seconds, 0);
  if (total < 2 * MILESTONE_SECONDS) return [];

  let bounds = walk(videos, MILESTONE_MAX, MILESTONE_SECONDS);
  if (bounds.length > MILESTONE_MAX_STAGES) {
    // Both bounds are widened, because either of them can be the one that
    // overflowed: 2462 clips of half a minute overflow the lecture cap, and a
    // 250-hour recording of hour-long lectures overflows the clock. Divided
    // through, each lands on about twenty stages either way.
    bounds = walk(
      videos,
      Math.ceil(videos.length / MILESTONE_MAX_STAGES),
      total / MILESTONE_MAX_STAGES
    );
  }
  if (bounds.length < 2) return [];

  return bounds.map((bound, index) => ({ ...bound, index: index + 1, total: bounds.length }));
}

/** One pass down the lectures, closing a stage on whichever bound comes first. */
function walk(
  videos: Video[],
  maxLectures: number,
  target: number
): Array<Omit<Segment, 'index' | 'total'>> {
  const bounds: Array<Omit<Segment, 'index' | 'total'>> = [];
  let from = 0;
  let seconds = 0;
  for (const [index, video] of videos.entries()) {
    seconds += video.seconds;
    const count = index - from + 1;
    const full = seconds >= target && count >= MILESTONE_MIN;
    if (full || count >= maxLectures) {
      bounds.push({ from, to: index, seconds });
      from = index + 1;
      seconds = 0;
    }
  }
  // Whatever is left over joins the stage before it rather than standing as a
  // one-lecture stage of its own: the tail of a course is where people are
  // most likely to be, and «Веха 13 · 1 лекция» is a milestone made of nothing.
  if (from < videos.length) {
    const tail = { from, to: videos.length - 1, seconds };
    const last = bounds[bounds.length - 1];
    if (last && videos.length - from < MILESTONE_MIN) {
      last.to = tail.to;
      last.seconds += tail.seconds;
    } else {
      bounds.push(tail);
    }
  }
  return bounds;
}

export type Milestone = Segment & {
  /** Lectures of it not behind you yet. */
  left: number;
  /** Their length, less whatever the player has already been through of them. */
  secondsLeft: number;
};

/**
 * The stage the reader is in the middle of, and what is left of it.
 *
 * The *first* stage holding an unwatched lecture, not the one after the last
 * tick: somebody who skipped ahead and came back is owed the gap, which is the
 * same rule `playlistProgress` follows for `next`.
 */
export function milestoneOf(profile: Profile, playlist: BuiltPlaylist): Milestone | null {
  const videos = playlist.videos;
  if (profile.playlists[playlist.id]?.watched) return null;
  const segments = segmentsOf(videos);
  if (!segments.length) return null;

  for (const segment of segments) {
    let left = 0;
    let secondsLeft = 0;
    for (let index = segment.from; index <= segment.to; index += 1) {
      const video = videos[index];
      if (!video) continue;
      const mark = profile.videos[video.id];
      if (mark?.done) continue;
      left += 1;
      secondsLeft += Math.max(0, video.seconds - (mark?.sec ?? 0));
    }
    if (left) return { ...segment, left, secondsLeft };
  }
  return null;
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
