import { describe, expect, it } from 'vitest';
import {
  DAY_GOALS,
  GOAL_DAYS,
  goalPairFor,
  migrateProfile,
  PROFILE_VERSION,
  ProfileSchema,
} from '../shared/schema.js';

/**
 * The migration is the one piece of code here that rewrites somebody's own
 * data, in place, with no way back — a stored profile is the whole of what a
 * reader has, and there is no server holding a copy. So each step gets a case
 * saying what it must not lose.
 */

/** The six weeks the old control offered, which is the whole population to migrate. */
const OLD_WEEK_GOALS = [1, 2, 3, 5, 7, 10];

describe('the goal, moved from a week to a day', () => {
  it('lands exactly on every week the old control could set', () => {
    for (const hours of OLD_WEEK_GOALS) {
      const { dayGoal, goalDays } = goalPairFor(hours);
      expect((dayGoal * goalDays) / 60).toBeCloseTo(hours, 5);
    }
  });

  it('only ever picks steps the control actually offers', () => {
    for (const hours of [...OLD_WEEK_GOALS, 4, 6, 8, 12, 0.5]) {
      const { dayGoal, goalDays } = goalPairFor(hours);
      expect(DAY_GOALS).toContain(dayGoal as (typeof DAY_GOALS)[number]);
      expect(GOAL_DAYS).toContain(goalDays as (typeof GOAL_DAYS)[number]);
    }
  });

  it('spreads a tie over more days rather than fewer', () => {
    // Two hours is 60×2 and 30×4; the wider spread is the one more likely to
    // be kept, and the one that makes «дней закрыто» worth counting.
    expect(goalPairFor(2).goalDays).toBeGreaterThan(2);
  });

  it('carries a version 3 goal across without changing what it meant', () => {
    const stored = {
      version: 3,
      updatedAt: '2026-08-01T00:00:00.000Z',
      courses: {},
      playlists: {},
      videos: {},
      recent: [],
      days: [{ day: '2026-08-01', sec: 3600, lectures: 1 }],
      settings: { lang: 'ru', theme: 'dark', resume: true, weekGoal: 5 },
    };

    const profile = ProfileSchema.parse(migrateProfile(stored));
    expect(profile.version).toBe(PROFILE_VERSION);
    expect(profile.settings.dayGoal).toBe(60);
    expect(profile.settings.goalDays).toBe(5);
    expect((profile.settings.dayGoal! * profile.settings.goalDays) / 60).toBe(5);
    // And the rest of it is untouched: a migration that resets a streak is a
    // migration that deletes the thing the profile was kept for.
    expect(profile.days).toHaveLength(1);
  });

  it('leaves a profile with no goal without one', () => {
    const profile = ProfileSchema.parse(
      migrateProfile({
        version: 3,
        updatedAt: '2026-08-01T00:00:00.000Z',
        courses: {},
        playlists: {},
        videos: {},
        recent: [],
        days: [],
        settings: { lang: 'ru', weekGoal: null },
      })
    );
    expect(profile.settings.dayGoal).toBeNull();
  });

  it('walks a version 1 profile through every step at once', () => {
    const profile = ProfileSchema.parse(
      migrateProfile({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        courses: { calculus: { status: 'done', favorite: false, at: '2026-01-01T00:00:00.000Z' } },
        playlists: {},
        videos: {},
        recent: [],
        days: ['2026-01-01'],
        settings: { weekGoal: 3 },
      })
    );
    // Version 2: a status set before the automation existed was set by hand.
    expect(profile.courses.calculus.manual).toBe(true);
    // Version 3: a bare day becomes a day worth nothing measured.
    expect(profile.days[0]).toEqual({ day: '2026-01-01', sec: 0, lectures: 0 });
    // Version 4: three hours a week, spread over the days it was likely meant for.
    expect((profile.settings.dayGoal! * profile.settings.goalDays) / 60).toBeCloseTo(3, 5);
  });
});
