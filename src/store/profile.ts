import { create } from 'zustand';
import { useMediaQuery } from '@/lib/hooks';
import {
  DAYS_LIMIT,
  migrateProfile,
  PROFILE_KEY,
  PROFILE_VERSION,
  ProfileSchema,
  RECENT_LIMIT,
  type CourseStatus,
  type DayLog,
  type Profile,
  type RecentEntry,
  type VideoMark,
} from '@shared/schema';

/**
 * The profile lives entirely in localStorage — there is no backend.
 *
 * Writes are debounced and wrapped in try/catch: Safari in private mode throws
 * on `setItem`, and a thrown storage error must never take the app down with it.
 */

function emptyProfile(): Profile {
  return ProfileSchema.parse({
    version: PROFILE_VERSION,
    updatedAt: new Date().toISOString(),
    courses: {},
    playlists: {},
    videos: {},
    recent: [],
    days: [],
  });
}

/**
 * Today, where the reader is standing.
 *
 * Not `toISOString().slice(0, 10)`, which is UTC: a lecture watched at eleven
 * at night in Moscow would be filed under tomorrow, and a streak would break on
 * a day somebody did study.
 */
export function localDay(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * What a write was worth, in the two units the log keeps.
 *
 * Both may be negative: unticking a lecture is a statement that it was not
 * watched, and the day it is taken off is the only day there is to take it off.
 */
export type Effort = { sec?: number; lectures?: number };

/**
 * Marks today as a day of study, and adds what the write was worth to it.
 *
 * Called from the writes that mean somebody was actually working — a lecture
 * ticked, a position recorded, a playlist opened, a course moved on — and from
 * none of the others. Switching the theme is not a day of study, and a streak
 * that could be kept alive by pressing the light switch would be worth nothing.
 *
 * A day never goes below zero. Taking back a lecture watched last week costs
 * this morning whatever it can and no more: the alternative is a negative week,
 * which is not a fact about anybody's studying.
 */
function credit(draft: Profile, effort: Effort): void {
  const day = localDay();
  const blank: DayLog = { day, sec: 0, lectures: 0 };
  const add = (entry: DayLog): DayLog => ({
    day,
    sec: Math.max(0, Math.round(entry.sec + (effort.sec ?? 0))),
    lectures: Math.max(0, entry.lectures + (effort.lectures ?? 0)),
  });

  // The tail is where today belongs on any profile written here; the general
  // path is for one merged from another machine, which can arrive out of order.
  const last = draft.days[draft.days.length - 1];
  if (last?.day === day) {
    draft.days = [...draft.days.slice(0, -1), add(last)];
    return;
  }
  const found = draft.days.find((entry) => entry.day === day);
  draft.days = [...draft.days.filter((entry) => entry.day !== day), add(found ?? blank)]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-DAYS_LIMIT);
}

export type LoadOutcome = 'ok' | 'empty' | 'unsupported-version' | 'corrupt';

function readProfile(): { profile: Profile; outcome: LoadOutcome } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PROFILE_KEY);
  } catch {
    return { profile: emptyProfile(), outcome: 'corrupt' };
  }
  if (!raw) return { profile: emptyProfile(), outcome: 'empty' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { profile: emptyProfile(), outcome: 'corrupt' };
  }

  // A *higher* version means a newer build of the site wrote this. Leave it
  // untouched and say so, rather than migrating it into something lossy. An
  // older one is ours to bring forward — that is what `migrateProfile` is for,
  // and the check used to reject those too, which would have locked every
  // profile in existence the day the shape changed.
  const version = (parsed as { version?: unknown }).version;
  if (typeof version === 'number' && version > PROFILE_VERSION) {
    return { profile: emptyProfile(), outcome: 'unsupported-version' };
  }

  const result = ProfileSchema.safeParse(migrateProfile(parsed));
  return result.success
    ? { profile: result.data, outcome: 'ok' }
    : { profile: emptyProfile(), outcome: 'corrupt' };
}

let writeTimer: ReturnType<typeof setTimeout> | undefined;

function persist(profile: Profile, blocked: boolean): void {
  if (blocked) return; // never overwrite a profile written by a newer version
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // Private mode, quota exceeded, storage disabled — the session still works.
    }
  }, 300);
}

const STATUS_CYCLE: Array<CourseStatus | null> = [null, 'in_progress', 'done'];
const STATUS_RANK: Record<string, number> = { done: 2, in_progress: 1, null: 0 };

/**
 * Which playlist a lecture belongs to, and which course that playlist is for.
 *
 * Marking a lecture is the one write that has consequences above itself — it
 * can finish a playlist, which can finish a course — and the store has no
 * catalogue to look any of that up in. So the caller, which is holding the
 * playlist already, says what it is part of.
 */
export type WatchContext = {
  courseId: string;
  playlistId: string;
  /**
   * Every lecture in the playlist, in order: what "all of it" means, and — the
   * lengths — what marking any of it off is worth. The lengths live in the
   * shard and nowhere else, and the shard is open exactly when somebody is
   * ticking things in it, so this is the one moment they can be had for free.
   */
  videos: Array<{ id: string; seconds: number }>;
};

/**
 * Bring a course's status in line with the lectures behind it.
 *
 * Runs on every watch event, and only while nobody has claimed the course by
 * hand: an untouched status is a reflection of the data, so it goes forward on
 * the first lecture and back if the lectures go away. `manual` is what stops
 * that — see the schema. Clearing a status by hand releases the claim, which is
 * how somebody hands the question back to the automation.
 */
function reconcileStatus(draft: Profile, ctx: WatchContext): void {
  const course = draft.courses[ctx.courseId];
  if (course?.manual) return;

  const sealed = draft.playlists[ctx.playlistId]?.watched ?? false;
  const watched = ctx.videos.filter((video) => draft.videos[video.id]?.done).length;
  const complete = sealed || (ctx.videos.length > 0 && watched === ctx.videos.length);
  const status: CourseStatus | null = complete ? 'done' : watched > 0 ? 'in_progress' : null;

  if ((course?.status ?? null) === status) return;
  draft.courses[ctx.courseId] = {
    status,
    favorite: course?.favorite ?? false,
    manual: false,
    at: new Date().toISOString(),
  };
}

/** Notes which lecture was last playing, so "continue" has somewhere to go. */
function touchPlaylist(draft: Profile, ctx: WatchContext, videoId?: string): void {
  const current = draft.playlists[ctx.playlistId];
  draft.playlists[ctx.playlistId] = {
    watched: current?.watched ?? false,
    favorite: current?.favorite ?? false,
    lastVideoId: videoId ?? current?.lastVideoId,
    courseId: ctx.courseId,
    at: new Date().toISOString(),
  };
}

export type ProfileStore = {
  profile: Profile;
  outcome: LoadOutcome;
  /** True when storage holds a profile from a future version — the UI shows a banner. */
  locked: boolean;

  courseStatus: (id: string) => CourseStatus | null;
  isCourseFavorite: (id: string) => boolean;
  isPlaylistWatched: (id: string) => boolean;
  isPlaylistFavorite: (id: string) => boolean;
  videoMark: (id: string) => VideoMark | undefined;

  cycleCourseStatus: (id: string) => void;
  setCourseStatus: (id: string, status: CourseStatus | null) => void;
  toggleCourseFavorite: (id: string) => void;
  togglePlaylistWatched: (id: string, ctx?: WatchContext) => void;
  togglePlaylistFavorite: (id: string) => void;

  /**
   * Tick or untick lectures. One id, or a range from a shift-click.
   *
   * `by` is which of the two ways it happened, and it decides whether the day's
   * log is charged for the lecture's whole length: a tick by hand is the only
   * claim that time was spent which nothing measured. The player pays for its
   * own time as it plays — see `recordPosition` — so a lecture it finishes is
   * counted as a lecture and nothing more.
   */
  setVideosDone: (
    videoIds: string[],
    done: boolean,
    ctx: WatchContext,
    by?: 'hand' | 'player'
  ) => void;
  /**
   * Where playback stopped, and how much of it was actually played since the
   * last report. Ignored when the reader has turned resuming off — the seconds
   * are not: they are a total for the day, not a record of where anybody was.
   */
  recordPosition: (videoId: string, sec: number, ctx: WatchContext, played?: number) => void;

  recordRecent: (entry: Omit<RecentEntry, 'at'>) => void;
  removeRecent: (id: string) => void;
  clearRecent: () => void;
  setSetting: <K extends keyof Profile['settings']>(
    key: K,
    value: Profile['settings'][K]
  ) => void;
  replaceProfile: (next: Profile) => void;
  mergeProfile: (incoming: Profile) => void;
  resetProfile: () => void;
};

const initial = readProfile();

export const useProfile = create<ProfileStore>((set, get) => {
  /**
   * Every write goes through here. `studied` says whether this one was somebody
   * working rather than somebody tidying — see `credit` — and the mutation says
   * what it was worth by returning it, since only the mutation can see what the
   * profile looked like before it ran.
   */
  const update = (mutate: (draft: Profile) => Effort | void, studied = false): void => {
    const current = get().profile;
    const next: Profile = {
      ...current,
      courses: { ...current.courses },
      playlists: { ...current.playlists },
      videos: { ...current.videos },
      recent: [...current.recent],
      days: [...current.days],
      settings: { ...current.settings },
      updatedAt: new Date().toISOString(),
    };
    const effort = mutate(next);
    if (studied) credit(next, effort ?? {});
    persist(next, get().locked);
    set({ profile: next });
  };

  /** A status the reader set themselves, which the automation then leaves alone. */
  const claim = (id: string, status: CourseStatus | null) =>
    update((draft) => {
      const current = draft.courses[id];
      draft.courses[id] = {
        status,
        favorite: current?.favorite ?? false,
        // Clearing is not an opinion, it is the withdrawal of one: the course
        // goes back to being counted from the lectures.
        manual: status !== null,
        at: new Date().toISOString(),
      };
    }, true);

  return {
    profile: initial.profile,
    outcome: initial.outcome,
    locked: initial.outcome === 'unsupported-version',

    courseStatus: (id) => get().profile.courses[id]?.status ?? null,
    isCourseFavorite: (id) => get().profile.courses[id]?.favorite ?? false,
    isPlaylistWatched: (id) => get().profile.playlists[id]?.watched ?? false,
    isPlaylistFavorite: (id) => get().profile.playlists[id]?.favorite ?? false,
    videoMark: (id) => get().profile.videos[id],

    cycleCourseStatus: (id) => {
      const current = get().profile.courses[id]?.status ?? null;
      claim(id, STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length]);
    },

    setCourseStatus: (id, status) => claim(id, status),

    toggleCourseFavorite: (id) =>
      update((draft) => {
        const current = draft.courses[id];
        draft.courses[id] = {
          status: current?.status ?? null,
          favorite: !(current?.favorite ?? false),
          manual: current?.manual ?? false,
          at: new Date().toISOString(),
        };
      }),

    togglePlaylistWatched: (id, ctx) =>
      update((draft) => {
        const sealing = !(draft.playlists[id]?.watched ?? false);
        const current = draft.playlists[id];
        draft.playlists[id] = {
          watched: sealing,
          favorite: current?.favorite ?? false,
          lastVideoId: current?.lastVideoId,
          courseId: ctx?.courseId ?? current?.courseId,
          at: new Date().toISOString(),
        };
        if (!ctx) return;
        reconcileStatus(draft, ctx);

        /*
         * The seal is a claim about every lecture under it that has no tick of
         * its own — those are already counted, and counting them twice is how
         * an afternoon becomes a week. What is left of each one is its length
         * minus wherever playback got to, which the player has already paid for.
         */
        let lectures = 0;
        let sec = 0;
        for (const video of ctx.videos) {
          const mark = draft.videos[video.id];
          if (mark?.done) continue;
          lectures += sealing ? 1 : -1;
          sec += sealing ? Math.max(0, video.seconds - (mark?.sec ?? 0)) : -video.seconds;
        }
        return { sec, lectures };
      }, true),

    togglePlaylistFavorite: (id) =>
      update((draft) => {
        const current = draft.playlists[id];
        draft.playlists[id] = {
          watched: current?.watched ?? false,
          favorite: !(current?.favorite ?? false),
          lastVideoId: current?.lastVideoId,
          courseId: current?.courseId,
          at: new Date().toISOString(),
        };
      }),

    setVideosDone: (videoIds, done, ctx, by = 'hand') =>
      update((draft) => {
        /*
         * What this changes, read before it changes anything.
         *
         * A lecture under a sealed playlist counts as watched without a mark of
         * its own, so that is what "was it done" means here — otherwise
         * unsealing by unticking one lecture would book the other three hundred
         * as watched this afternoon.
         */
        const sealed = draft.playlists[ctx.playlistId]?.watched ?? false;
        const length = new Map(ctx.videos.map((video) => [video.id, video.seconds]));
        let lectures = 0;
        let sec = 0;
        for (const videoId of videoIds) {
          const mark = draft.videos[videoId];
          if (((mark?.done ?? false) || sealed) === done) continue;
          lectures += done ? 1 : -1;
          if (done) {
            if (by === 'hand') sec += Math.max(0, (length.get(videoId) ?? 0) - (mark?.sec ?? 0));
          } else {
            sec -= length.get(videoId) ?? 0;
          }
        }

        for (const videoId of videoIds) {
          // A finished lecture keeps no position: there is nothing to resume.
          if (done) draft.videos[videoId] = { done: true };
          else delete draft.videos[videoId];
        }
        /*
         * Ticking a lecture of a sealed playlist is a contradiction, and the
         * tick is the more specific statement — so the seal comes off and what
         * it was standing for is written out as the ticks it meant. Without
         * this, unticking one lecture of a sealed playlist would appear to do
         * nothing at all.
         */
        if (!done && draft.playlists[ctx.playlistId]?.watched) {
          const untouched = ctx.videos
            .map((video) => video.id)
            .filter((id) => !videoIds.includes(id));
          for (const id of untouched) draft.videos[id] = { done: true };
          draft.playlists[ctx.playlistId] = {
            ...draft.playlists[ctx.playlistId]!,
            watched: false,
            at: new Date().toISOString(),
          };
        }
        touchPlaylist(draft, ctx, done ? videoIds[videoIds.length - 1] : undefined);
        reconcileStatus(draft, ctx);
        return { sec, lectures };
      }, true),

    recordPosition: (videoId, sec, ctx, played = 0) =>
      update((draft) => {
        touchPlaylist(draft, ctx, videoId);
        // The position is a per-lecture record and the reader can switch it
        // off; the seconds are a total for the day and stay either way.
        if (draft.settings.resume && !draft.videos[videoId]?.done) {
          draft.videos[videoId] = { sec: Math.round(sec), done: false };
        }
        return { sec: played };
      }, true),

    /** Re-opening a playlist moves it to the top rather than adding a duplicate. */
    recordRecent: (entry) =>
      update((draft) => {
        draft.recent = [
          { ...entry, at: new Date().toISOString() },
          ...draft.recent.filter((item) => item.id !== entry.id),
        ].slice(0, RECENT_LIMIT);
      }, true),

    removeRecent: (id) =>
      update((draft) => {
        draft.recent = draft.recent.filter((item) => item.id !== id);
      }),

    clearRecent: () =>
      update((draft) => {
        draft.recent = [];
      }),

    setSetting: (key, value) =>
      update((draft) => {
        draft.settings = { ...draft.settings, [key]: value };
      }),

    replaceProfile: (next) => {
      persist(next, false);
      set({ profile: next, locked: false, outcome: 'ok' });
    },

    /** Merge by id; on a status conflict the more advanced one wins. */
    mergeProfile: (incoming) =>
      update((draft) => {
        for (const [id, entry] of Object.entries(incoming.courses)) {
          const existing = draft.courses[id];
          if (!existing) {
            draft.courses[id] = entry;
            continue;
          }
          const existingRank = STATUS_RANK[String(existing.status)] ?? 0;
          const incomingRank = STATUS_RANK[String(entry.status)] ?? 0;
          const incomingWins = incomingRank > existingRank;
          draft.courses[id] = {
            status: incomingWins ? entry.status : existing.status,
            favorite: existing.favorite || entry.favorite,
            // The claim travels with the status it was made about: a course
            // finished by hand on one machine must not be walked back by the
            // automation on the other.
            manual: incomingWins ? entry.manual : existing.manual,
            at: entry.at > existing.at ? entry.at : existing.at,
          };
        }
        for (const [id, entry] of Object.entries(incoming.playlists)) {
          const existing = draft.playlists[id];
          draft.playlists[id] = existing
            ? {
                watched: existing.watched || entry.watched,
                favorite: existing.favorite || entry.favorite,
                lastVideoId:
                  entry.at > existing.at
                    ? (entry.lastVideoId ?? existing.lastVideoId)
                    : (existing.lastVideoId ?? entry.lastVideoId),
                courseId: existing.courseId ?? entry.courseId,
                at: entry.at > existing.at ? entry.at : existing.at,
              }
            : entry;
        }
        // A lecture watched on either machine is watched; short of that, the
        // further-along position is the useful one to come back to.
        for (const [id, entry] of Object.entries(incoming.videos)) {
          const existing = draft.videos[id];
          if (!existing) {
            draft.videos[id] = entry;
            continue;
          }
          const done = existing.done || entry.done;
          draft.videos[id] = done
            ? { done: true }
            : { done: false, sec: Math.max(existing.sec ?? 0, entry.sec ?? 0) };
        }

        // History interleaves by time and keeps the later visit of a repeat.
        const byId = new Map(draft.recent.map((item) => [item.id, item]));
        for (const item of incoming.recent) {
          const existing = byId.get(item.id);
          if (!existing || item.at > existing.at) byId.set(item.id, item);
        }
        draft.recent = [...byId.values()]
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, RECENT_LIMIT);

        /*
         * A day studied on either machine is a day studied — the union, which
         * is the only merge that cannot break a streak somebody really kept.
         *
         * What a shared day was worth is the larger of the two rather than the
         * sum: the usual reason for a merge is the same profile arriving back
         * from another browser, and adding those together would double every
         * hour on it. Two machines genuinely used on one day lose the smaller
         * half, which is the cheaper of the two mistakes.
         */
        const byDay = new Map(draft.days.map((entry) => [entry.day, entry]));
        for (const entry of incoming.days) {
          const existing = byDay.get(entry.day);
          byDay.set(entry.day, {
            day: entry.day,
            sec: Math.max(existing?.sec ?? 0, entry.sec),
            lectures: Math.max(existing?.lectures ?? 0, entry.lectures),
          });
        }
        draft.days = [...byDay.values()]
          .sort((a, b) => a.day.localeCompare(b.day))
          .slice(-DAYS_LIMIT);
      }),

    resetProfile: () => {
      try {
        localStorage.removeItem(PROFILE_KEY);
      } catch {
        // Nothing to do — the in-memory reset below is still correct.
      }
      set({ profile: emptyProfile(), locked: false, outcome: 'empty' });
    },
  };
});

export type Theme = Profile['settings']['theme'];

/**
 * The theme actually in force. «Авто» means dark unless the system asks for
 * light — the palette is designed dark-first, so that is the better guess when
 * nothing is stated.
 *
 * Kept as a function of both inputs so the toggle in the header and the <html>
 * attribute cannot disagree about what «Авто» currently resolves to.
 */
export function resolveTheme(theme: Theme, prefersLight: boolean): 'dark' | 'light' {
  if (theme !== 'auto') return theme;
  return prefersLight ? 'light' : 'dark';
}

/** Applies the theme setting to <html> so CSS variables switch. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(
    theme,
    window.matchMedia('(prefers-color-scheme: light)').matches
  );
}

/**
 * The theme in force, for the things CSS variables cannot reach: generated SVG
 * and colours computed from the domain palette.
 */
export function useResolvedTheme(): 'dark' | 'light' {
  const theme = useProfile((state) => state.profile.settings.theme);
  return resolveTheme(theme, useMediaQuery('(prefers-color-scheme: light)'));
}
