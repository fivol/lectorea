import { useMemo } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { pathTo, useCatalog } from './catalog';
import { pathProgress, useCourseProgress, type PathProgress } from './progress';
import { useProfile } from '@/store/profile';

/**
 * A goal is a favourited course, and what it costs is the path to it.
 *
 * Both screens ask the same two questions about them — how far along is this
 * one, and how far along are all of them — so both are answered here rather
 * than twice over. The whole-course arithmetic needs nothing but the catalogue,
 * which is what lets the front page carry the same number as the profile
 * without downloading a single playlist; `detailed` is what buys the
 * part-finished course in hand, and with it the shards it lives in.
 */

export type Goal = {
  course: BuiltCourse;
  /** The path to it, in order, with the course itself last. */
  steps: string[];
};

export function useGoals(): Goal[] {
  const catalog = useCatalog();
  const courses = useProfile((state) => state.profile.courses);

  return useMemo(() => {
    const out: Goal[] = [];
    for (const [id, entry] of Object.entries(courses)) {
      if (!entry.favorite) continue;
      const course = catalog.courseById.get(id);
      if (!course) continue;
      out.push({ course, steps: [...pathTo(catalog, id).map((step) => step.id), id] });
    }
    return out.sort((a, b) => a.steps.length - b.steps.length);
  }, [courses, catalog]);
}

export type GoalProgress = {
  progress: PathProgress;
  /** What is left of it, by the catalogue's estimate. */
  remainingHours: number;
};

/** One goal, read against the profile. */
export function useGoalProgress(steps: string[], detailed = true): GoalProgress {
  const catalog = useCatalog();
  const profile = useProfile((state) => state.profile);
  const byCourse = useCourseProgress(detailed ? steps : EMPTY);

  return useMemo(() => {
    const progress = pathProgress(
      steps,
      (id) => profile.courses[id]?.status === 'done',
      (id) => byCourse.get(id) ?? null
    );
    let remainingHours = 0;
    for (const id of steps) {
      if (profile.courses[id]?.status === 'done') continue;
      remainingHours += catalog.courseById.get(id)?.hours ?? 0;
    }
    return { progress, remainingHours };
  }, [steps, profile.courses, byCourse, catalog]);
}

/**
 * Every goal at once: the courses on the way to any of them, counted once.
 *
 * Two goals in the same field share most of their path, and adding the paths up
 * would charge for the same prerequisite twice — so this is the union, which is
 * also the honest answer to "how much of what I want is behind me".
 */
export function useGoalsProgress(detailed = true): GoalProgress & { goals: number } {
  const goals = useGoals();
  const steps = useMemo(() => {
    const set = new Set<string>();
    for (const goal of goals) for (const id of goal.steps) set.add(id);
    return [...set];
  }, [goals]);

  return { ...useGoalProgress(steps, detailed), goals: goals.length };
}

/** The goal closest to being finished — the one worth naming on the front page. */
export function useNearestGoal(): (Goal & GoalProgress) | null {
  const goals = useGoals();
  const catalog = useCatalog();
  const profile = useProfile((state) => state.profile);

  return useMemo(() => {
    let best: (Goal & GoalProgress) | null = null;
    for (const goal of goals) {
      const progress = pathProgress(
        goal.steps,
        (id) => profile.courses[id]?.status === 'done',
        () => null
      );
      let remainingHours = 0;
      for (const id of goal.steps) {
        if (profile.courses[id]?.status === 'done') continue;
        remainingHours += catalog.courseById.get(id)?.hours ?? 0;
      }
      // A goal already reached is no longer the thing to point at, and among
      // the rest the nearest one is the one with the least left to do.
      if (progress.done >= progress.total) continue;
      if (!best || progress.fraction > best.progress.fraction) {
        best = { ...goal, progress, remainingHours };
      }
    }
    return best;
  }, [goals, profile.courses, catalog]);
}

const EMPTY: string[] = [];
