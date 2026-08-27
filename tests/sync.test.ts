import { describe, expect, it } from 'vitest';
import { PROFILE_VERSION, ProfileSchema, type Profile } from '../shared/schema.js';
import { decideSync, readCloud, settingsFor, writeCloud } from '../src/lib/sync.js';
import { mergeProfiles } from '../src/lib/profile-merge.js';

/**
 * The sync is the first thing in this project that can lose somebody's year of
 * marks over an ordering it got wrong, and it does it on a machine nobody is
 * watching. So the two decisions it makes are tested as arithmetic: which of
 * push, pull and merge, and what a merge does to two profiles.
 *
 * The case that matters most is the one the whole design turns on — a merge is
 * a union and cannot carry an erasure, so an erasure has to reach the other
 * device as a *pull*, and `decideSync` is the only thing standing between those
 * two answers.
 */

function profile(over: Partial<Profile> = {}): Profile {
  return ProfileSchema.parse({
    version: PROFILE_VERSION,
    updatedAt: '2026-01-01T00:00:00.000Z',
    courses: {},
    playlists: {},
    videos: {},
    recent: [],
    days: [],
    ...over,
  });
}

describe('which way the profile moves', () => {
  it('pushes when the account has no cloud copy at all', () => {
    expect(decideSync({ linked: false, localRev: 0, dirty: true, remoteRev: null })).toBe('push');
    expect(decideSync({ linked: true, localRev: 4, dirty: false, remoteRev: null })).toBe('push');
  });

  it('merges the first time a device meets an account, however clean it looks', () => {
    // The device has never synced this account: whatever is in this browser and
    // whatever is in the cloud are two independent histories, and dropping
    // either of them is the one unrecoverable mistake available here.
    expect(decideSync({ linked: false, localRev: 0, dirty: false, remoteRev: 7 })).toBe('merge');
  });

  it('pulls — not merges — when only the cloud has moved', () => {
    // This is the line that lets an untick on the phone reach the laptop. A
    // merge here would union the tick straight back on.
    expect(decideSync({ linked: true, localRev: 7, dirty: false, remoteRev: 8 })).toBe('pull');
  });

  it('merges only when both sides have moved', () => {
    expect(decideSync({ linked: true, localRev: 7, dirty: true, remoteRev: 8 })).toBe('merge');
  });

  it('pushes local work sitting on the current revision, and idles without it', () => {
    expect(decideSync({ linked: true, localRev: 7, dirty: true, remoteRev: 7 })).toBe('push');
    expect(decideSync({ linked: true, localRev: 7, dirty: false, remoteRev: 7 })).toBe('idle');
  });

  it('pushes when the cloud copy has been deleted and started again behind us', () => {
    expect(decideSync({ linked: true, localRev: 9, dirty: false, remoteRev: 2 })).toBe('push');
  });
});

describe('merging two profiles', () => {
  const laptop = profile({
    updatedAt: '2026-03-02T00:00:00.000Z',
    courses: { calculus: { status: 'in_progress', favorite: false, manual: false, at: '2026-03-01T00:00:00.000Z' } },
    videos: { a: { done: true }, b: { done: false, sec: 400 } },
    days: [{ day: '2026-03-01', sec: 3600, lectures: 2 }],
  });
  const phone = profile({
    updatedAt: '2026-03-03T00:00:00.000Z',
    courses: { calculus: { status: 'done', favorite: true, manual: true, at: '2026-03-03T00:00:00.000Z' } },
    videos: { b: { done: false, sec: 900 }, c: { done: true } },
    days: [{ day: '2026-03-02', sec: 1800, lectures: 1 }],
  });

  it('gives the same answer in either order, and none at all the second time', () => {
    const one = mergeProfiles(laptop, phone);
    const other = mergeProfiles(phone, laptop);
    /*
     * `updatedAt` and `settings` belong to whoever is applying the merge, so
     * the comparison is over the marks, which are what has to agree — and by
     * value rather than as JSON: the two orders insert the same keys in
     * different sequences, which a string comparison would call a difference
     * and a reader never could.
     */
    const marks = (p: Profile) => [p.courses, p.playlists, p.videos, p.days];
    expect(marks(one)).toEqual(marks(other));
    expect(marks(mergeProfiles(one, phone))).toEqual(marks(one));
  });

  it('keeps the further status, the further position and every day either side had', () => {
    const merged = mergeProfiles(laptop, phone);
    expect(merged.courses.calculus.status).toBe('done');
    expect(merged.courses.calculus.manual).toBe(true);
    expect(merged.videos.a.done).toBe(true);
    expect(merged.videos.b.sec).toBe(900);
    expect(merged.days.map((day) => day.day)).toEqual(['2026-03-01', '2026-03-02']);
  });
});

describe('settings, which do not merge', () => {
  it('takes the newer profile whole, and leaves the split where it was measured', () => {
    const here = profile({ updatedAt: '2026-01-01T00:00:00.000Z' });
    here.settings = { ...here.settings, theme: 'light', splitRatio: 0.4, dayGoal: 30 };
    const there = profile({ updatedAt: '2026-06-01T00:00:00.000Z' });
    there.settings = { ...there.settings, theme: 'dark', splitRatio: 0.75, dayGoal: 90 };

    const chosen = settingsFor(here, there);
    expect(chosen.theme).toBe('dark');
    expect(chosen.dayGoal).toBe(90);
    expect(chosen.splitRatio).toBe(0.4);

    // And the other way round, so it is the timestamp deciding rather than the
    // argument position.
    expect(settingsFor(there, here).theme).toBe('dark');
  });
});

describe('the cloud document', () => {
  it('round-trips a profile through the string it is stored as', () => {
    const stored = writeCloud(laptopish(), 12);
    const read = readCloud(stored);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.rev).toBe(12);
    expect(read.profile.videos.a.done).toBe(true);
  });

  it('refuses a copy written by a newer build rather than migrating it down', () => {
    const stored = { ...writeCloud(laptopish(), 3), version: PROFILE_VERSION + 1 };
    expect(readCloud(stored).kind).toBe('newer');
  });

  it('reads an absent or unreadable document as something to replace, not as data', () => {
    expect(readCloud(null).kind).toBe('empty');
    expect(readCloud({ rev: 2, version: PROFILE_VERSION, data: '{oops' }).kind).toBe('corrupt');
  });

  function laptopish(): Profile {
    return profile({ videos: { a: { done: true } } });
  }
});
