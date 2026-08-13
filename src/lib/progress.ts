import { useEffect, useMemo, useState } from 'react';
import type { BuiltPlaylist, Profile, RecentEntry, Video } from '@shared/schema';
import { loadPlaylistsCached } from './data';
import { useProfile } from '@/store/profile';

/**
 * How far through something somebody is.
 *
 * Every number the interface shows about progress is computed here, from two
 * inputs and nothing else: the profile, and the playlists in hand. Three levels
 * ask three different questions, and only the bottom one holds any state —
 * a lecture is watched or it is not, and a playlist and a course are arithmetic
 * over that.
 *
 * The one exception is the seal (`playlists[id].watched`), which says "all of
 * it" without writing a tick per lecture. It reads as a full house here and
 * uncovers whatever is underneath the moment it comes off.
 */

export type PlaylistProgress = {
  /** Lectures behind you. Equals `total` when the playlist is sealed. */
  done: number;
  total: number;
  /** Sealed by hand, or every lecture ticked. */
  complete: boolean;
  /**
   * 0..1, for a bar — measured in time, not in lectures.
   *
   * Counting lectures makes every one of them the same size, and they are not:
   * a course whose first four are twenty minutes and whose last four are two
   * hours would read as half done at a fifth of the work. Time is what is
   * actually left to spend, so time is what the bar is filled to, and the
   * labels carry both numbers because "seven of fourteen" is the one people
   * count in.
   */
  fraction: number;
  /** Anything at all — a tick, a seal, a part-watched lecture. */
  started: boolean;
  /** Roughly how much of it has been watched, in seconds. */
  watchedSeconds: number;
  /** What the watched seconds are out of — the lectures we know about. */
  totalSeconds: number;
  /** What to play next, and where to drop back in. Null once it is finished. */
  next: { video: Video; index: number; sec: number } | null;
};

const EMPTY: PlaylistProgress = {
  done: 0,
  total: 0,
  complete: false,
  fraction: 0,
  started: false,
  watchedSeconds: 0,
  totalSeconds: 0,
  next: null,
};

/**
 * A playlist, read against the profile.
 *
 * `next` is the first lecture that is not behind you, not the one after the
 * last one watched: somebody who skipped ahead and came back should be offered
 * the gap rather than the end. The resume position comes with it, so the caller
 * never has to reach into `videos` itself.
 */
export function playlistProgress(profile: Profile, playlist: BuiltPlaylist): PlaylistProgress {
  const videos = playlist.videos;
  // `videoCount` is what YouTube reported and `videos` is what the crawl got:
  // they can differ for a playlist with a private entry in it, and the list we
  // can actually tick through is the honest denominator.
  const total = videos.length || playlist.videoCount;
  if (!total) return EMPTY;

  // The lectures we can actually account for, not what YouTube reported for the
  // playlist as a whole: the bar has to be filled out of the same pot it is
  // filled from, or a shard missing a private video would never reach the end.
  const totalSeconds =
    videos.reduce((sum, video) => sum + video.seconds, 0) || playlist.totalSeconds;

  const sealed = profile.playlists[playlist.id]?.watched ?? false;
  if (sealed) {
    return {
      done: total,
      total,
      complete: true,
      fraction: 1,
      started: true,
      watchedSeconds: totalSeconds,
      totalSeconds,
      next: null,
    };
  }

  let done = 0;
  let watchedSeconds = 0;
  let next: PlaylistProgress['next'] = null;

  for (const [index, video] of videos.entries()) {
    const mark = profile.videos[video.id];
    if (mark?.done) {
      done += 1;
      watchedSeconds += video.seconds;
      continue;
    }
    // Part of a lecture counts as the part of it that it is, so the bar moves
    // during a two-hour recording instead of standing still until it ends.
    const sec = mark?.sec ?? 0;
    watchedSeconds += Math.min(sec, video.seconds);
    if (!next) next = { video, index, sec };
  }

  const complete = done >= total;
  return {
    done,
    total,
    complete,
    fraction: complete ? 1 : totalSeconds ? watchedSeconds / totalSeconds : 0,
    started: done > 0 || watchedSeconds > 0,
    watchedSeconds,
    totalSeconds,
    next,
  };
}

export type CourseProgress = PlaylistProgress & {
  /** The playlist these numbers are about. */
  playlist: BuiltPlaylist;
  /** Whether it was picked because it is the furthest along or the last played. */
  reason: 'furthest' | 'last-played';
};

/**
 * A course, read through the one playlist it is being studied by.
 *
 * A course carries thirteen recordings on average and they are alternatives,
 * not parts: nobody watches the same lectures three times over, and summing
 * them would turn a course somebody has barely started into one that is nearly
 * finished. So the number is the furthest-along recording, with the last one
 * actually played breaking a tie — which is also the one "continue" should
 * open, since a tie means the count cannot tell them apart but the reader can.
 */
export function courseProgress(
  profile: Profile,
  playlists: BuiltPlaylist[]
): CourseProgress | null {
  let best: CourseProgress | null = null;

  for (const playlist of playlists) {
    const progress = playlistProgress(profile, playlist);
    if (!progress.started) continue;

    if (!best || progress.fraction > best.fraction) {
      best = { ...progress, playlist, reason: 'furthest' };
      continue;
    }
    if (progress.fraction < best.fraction) continue;

    const at = profile.playlists[playlist.id]?.at ?? '';
    const bestAt = profile.playlists[best.playlist.id]?.at ?? '';
    if (at > bestAt) best = { ...progress, playlist, reason: 'last-played' };
  }

  return best;
}

export type PathProgress = {
  /** Courses fully behind you. What the "3 из 7" in the label counts. */
  done: number;
  total: number;
  /**
   * The same, plus the part-finished ones counted as the fraction they are —
   * what the bar is filled to. Always at least `done / total`.
   */
  fraction: number;
  /** Just the part-finished share, drawn in the second tone. */
  partial: number;
};

/**
 * A path, counted in courses but filled in fractions.
 *
 * Counting whole courses alone makes a bar that does not move for a fortnight
 * while somebody works through a forty-hour prerequisite; counting only
 * fractions loses the milestone. So both: the label says how many are behind
 * you, and the bar carries the course in hand as the part of it that is done.
 *
 * `progressOf` returns what is known about a course — null while its shard is
 * still loading, which simply leaves that course counted the old way.
 */
export function pathProgress(
  courseIds: string[],
  isDone: (courseId: string) => boolean,
  progressOf: (courseId: string) => CourseProgress | null
): PathProgress {
  const total = courseIds.length;
  if (!total) return { done: 0, total: 0, fraction: 0, partial: 0 };

  let done = 0;
  let partialSum = 0;

  for (const id of courseIds) {
    if (isDone(id)) {
      done += 1;
      continue;
    }
    const progress = progressOf(id);
    if (progress && !progress.complete) partialSum += progress.fraction;
  }

  return {
    done,
    total,
    fraction: (done + partialSum) / total,
    partial: partialSum / total,
  };
}

/** `0.481` → `48`. One place, so the bar and its label never disagree by a point. */
export function percent(fraction: number): number {
  return Math.round(fraction * 100);
}

/**
 * What is known about a set of courses, once their playlists have arrived.
 *
 * Lecture-level progress lives in the shards, which are fetched per course and
 * cached for the session — so a path of seven asks for seven small files the
 * first time it is looked at, and for nothing at all afterwards. The map fills
 * in as they land rather than making the screen wait: a bar that starts by
 * counting whole courses and refines a moment later is better than a bar that
 * is not there yet.
 */
export function useCourseProgress(courseIds: string[]): Map<string, CourseProgress> {
  const profile = useProfile((state) => state.profile);

  /*
   * Only the courses that can possibly have anything.
   *
   * Every write that records a lecture also stamps the course onto the playlist
   * entry, so a course with no entry pointing at it has no progress to find —
   * and asking for its shard would be pulling up to three quarters of a
   * megabyte to be told zero. A path of nine courses usually needs one file
   * this way, and often none.
   */
  const touched = useMemo(() => {
    const set = new Set<string>();
    for (const entry of Object.values(profile.playlists)) {
      if (entry.courseId) set.add(entry.courseId);
    }
    return set;
  }, [profile.playlists]);

  const wanted = useMemo(
    () => courseIds.filter((id) => touched.has(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [courseIds.join(','), touched]
  );
  const shards = useCourseShards(wanted);

  return useMemo(() => {
    const out = new Map<string, CourseProgress>();
    for (const [id, playlists] of shards) {
      const progress = courseProgress(profile, playlists);
      if (progress) out.set(id, progress);
    }
    return out;
  }, [shards, profile]);
}

export type WatchEntry = {
  entry: RecentEntry;
  playlist: BuiltPlaylist;
  progress: PlaylistProgress;
};

/**
 * The recently-opened playlists that still have something left in them.
 *
 * Deliberately shallow. Progress lives in the shards, a shard runs from a few
 * kilobytes to three quarters of a megabyte, and history holds sixty entries —
 * so a screen that drew a bar on every row would pull the catalogue down to
 * decorate a list. The most recent handful is where "continue" actually points,
 * and the rest of the history is a list of names, which is what it was.
 */
export function useRecentWatch(courseLimit = 5): Map<string, WatchEntry> {
  const profile = useProfile((state) => state.profile);
  const recent = profile.recent;

  const courseIds = useMemo(() => {
    const seen: string[] = [];
    for (const entry of recent) {
      if (seen.length >= courseLimit) break;
      if (!seen.includes(entry.courseId)) seen.push(entry.courseId);
    }
    return seen;
  }, [recent, courseLimit]);

  const byCourse = useCourseShards(courseIds);

  return useMemo(() => {
    const out = new Map<string, WatchEntry>();
    for (const entry of recent) {
      const playlist = byCourse.get(entry.courseId)?.find((item) => item.id === entry.id);
      if (!playlist) continue;
      out.set(entry.id, { entry, playlist, progress: playlistProgress(profile, playlist) });
    }
    return out;
  }, [recent, byCourse, profile]);
}

/**
 * Where to drop somebody back in: the last thing they opened that is not
 * finished, and the lecture inside it they had not got to.
 */
export function useContinue(): WatchEntry | null {
  const watched = useRecentWatch();
  const recent = useProfile((state) => state.profile.recent);

  return useMemo(() => {
    for (const entry of recent) {
      const found = watched.get(entry.id);
      if (found?.progress.started && found.progress.next) return found;
    }
    return null;
  }, [recent, watched]);
}

/** The shards for a set of courses, filling in as they land. */
function useCourseShards(courseIds: string[]): Map<string, BuiltPlaylist[]> {
  const [shards, setShards] = useState<Map<string, BuiltPlaylist[]>>(new Map());
  const key = courseIds.join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (!ids.length) return;
    let cancelled = false;
    Promise.all(
      ids.map(async (id) => [id, await loadPlaylistsCached(id)] as const)
    ).then((pairs) => {
      if (!cancelled) setShards(new Map(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return shards;
}
