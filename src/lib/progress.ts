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

/**
 * The same question as `useContinue`, answered without downloading anything.
 *
 * The front page cannot afford the shards: a course's playlists run to three
 * quarters of a megabyte and the map is the first thing anyone sees. Everything
 * here is already in the profile — the playlist that was open last, its title,
 * and the lecture that was playing, which is enough for a thumbnail and a name.
 * What it cannot know is how far through that playlist somebody is, so it says
 * nothing about that; a sealed playlist is skipped, being the one case the
 * profile does record as finished.
 */
export type ResumePointer = { entry: RecentEntry; lastVideoId?: string };

/**
 * @param within Only courses in this set count, for a screen that is looking at
 *   part of the catalogue rather than at all of it. The columns filtered to a
 *   field offer where you stopped **in that field**: the last thing opened
 *   anywhere is the front page's answer, and repeating it over a field somebody
 *   has deliberately narrowed to is an offer about a different subject
 *   altogether. Omitted on the front page, where the whole catalogue is the
 *   slice.
 */
export function useResumePointer(within?: ReadonlySet<string> | null): ResumePointer | null {
  return useResumeList(within, 1)[0] ?? null;
}

/**
 * A dozen. `recent` holds sixty, and a card offering «продолжить» sixty times
 * over is a history browser — which the profile panel already is, and better.
 * Twelve is more than anybody is studying at once and short enough that the
 * counter beside the arrow stays a number rather than a warning.
 */
const RESUME_LIST_LIMIT = 12;

/**
 * Everything there is to go back to, newest first — the same question as
 * `useResumePointer`, asked of more than the first answer.
 *
 * It exists because a reader with three courses on the go was being offered one
 * of them and told nothing about the other two. The arrow on the card leafs
 * through this, and the set it is asked of decides what «all of them» means:
 * the front page hands no filter and gets the catalogue, the columns hand their
 * own filter and get the field.
 *
 * Deduplicated by playlist, because `recent` records openings and the same
 * recording opened twice is one thing to continue.
 */
export function useResumeList(
  within?: ReadonlySet<string> | null,
  limit = RESUME_LIST_LIMIT
): ResumePointer[] {
  const profile = useProfile((state) => state.profile);

  return useMemo(() => {
    const out: ResumePointer[] = [];
    const seen = new Set<string>();
    for (const entry of profile.recent) {
      if (out.length >= limit) break;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      if (within && !within.has(entry.courseId)) continue;
      const saved = profile.playlists[entry.id];
      if (saved?.watched) continue;
      out.push({ entry, lastVideoId: saved?.lastVideoId });
    }
    return out;
  }, [profile.recent, profile.playlists, within, limit]);
}

/**
 * How far through the offered recording somebody actually is.
 *
 * This is the one thing `useResumePointer` deliberately cannot answer: lecture
 * lengths and the list of lectures live in the shards, and the front page used
 * to say nothing about progress rather than pay for one. It pays for exactly one
 * now — the shard of the course being offered, median 69 KB — and only after the
 * card is already on screen, so nothing waits for it. It is also the shard that
 * pressing the card is about to need, which makes it a prefetch rather than a
 * cost; `loadPlaylistsCached` and the service worker see to it that the second
 * screen asking gets it for nothing.
 *
 * Null until it lands, and null for good if the playlist has since left the
 * catalogue — the card is complete without the bar, which is why the bar may
 * arrive late.
 */
export function useResumeProgress(resume: ResumePointer | null): PlaylistProgress | null {
  const profile = useProfile((state) => state.profile);
  const courseId = resume?.entry.courseId ?? null;
  const courseIds = useMemo(() => (courseId ? [courseId] : []), [courseId]);
  const shards = useCourseShards(courseIds);

  return useMemo(() => {
    if (!resume) return null;
    const playlist = shards
      .get(resume.entry.courseId)
      ?.find((item) => item.id === resume.entry.id);
    return playlist ? playlistProgress(profile, playlist) : null;
  }, [resume, shards, profile]);
}

/** Hours and lectures behind you, across everything the profile knows about. */
export type WatchedTotals = {
  /** Distinct lectures ticked off, sealed playlists included. */
  lectures: number;
  /** Their length, plus part-watched lectures as the part they are. */
  seconds: number;
};

/**
 * How much has actually been watched.
 *
 * Lecture lengths live in the shards and nowhere else, so this is a floor that
 * rises as they land — hence the «≈» wherever it is printed. The set is capped
 * because it is a headline number, not a ledger: somebody who has touched forty
 * courses should not pay ten megabytes to be told roughly how many hours they
 * have spent, and the most recent dozen carry nearly all of them anyway.
 */
const STATS_COURSE_LIMIT = 12;

/**
 * The courses the profile has actually touched, most recently first.
 *
 * Every write that records a lecture stamps the course onto the playlist entry,
 * so this is the whole set of shards worth asking for — and the cap is what
 * keeps a headline number from costing ten megabytes.
 */
export function touchedCourses(profile: Profile, limit = STATS_COURSE_LIMIT): string[] {
  const seen = new Map<string, string>();
  for (const entry of Object.values(profile.playlists)) {
    if (!entry.courseId) continue;
    const at = seen.get(entry.courseId);
    if (!at || entry.at > at) seen.set(entry.courseId, entry.at);
  }
  return [...seen.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, limit)
    .map(([id]) => id);
}

export function useWatchedTotals(): WatchedTotals {
  const profile = useProfile((state) => state.profile);

  const courseIds = useMemo(() => touchedCourses(profile), [profile]);

  const shards = useCourseShards(courseIds);

  return useMemo(() => {
    // Keyed by lecture rather than by playlist: the same recording turns up in
    // more than one of them, and watching it once is watching it once.
    const length = new Map<string, number>();
    const done = new Set<string>();

    for (const playlists of shards.values()) {
      for (const playlist of playlists) {
        const sealed = profile.playlists[playlist.id]?.watched ?? false;
        for (const video of playlist.videos) {
          length.set(video.id, video.seconds);
          if (sealed) done.add(video.id);
        }
      }
    }

    for (const [id, mark] of Object.entries(profile.videos)) {
      if (mark.done) done.add(id);
    }

    let seconds = 0;
    for (const id of done) seconds += length.get(id) ?? 0;
    for (const [id, mark] of Object.entries(profile.videos)) {
      if (mark.done || done.has(id) || !mark.sec) continue;
      seconds += Math.min(mark.sec, length.get(id) ?? mark.sec);
    }

    return { lectures: done.size, seconds };
  }, [shards, profile.videos, profile.playlists]);
}

/** The shards for a set of courses, filling in as they land. */
export function useCourseShards(courseIds: string[]): Map<string, BuiltPlaylist[]> {
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
