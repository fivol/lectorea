import { create } from 'zustand';
import {
  PROFILE_KEY,
  ProfileSchema,
  RECENT_LIMIT,
  type CourseStatus,
  type Profile,
  type RecentEntry,
} from '@shared/schema';

/**
 * The profile lives entirely in localStorage — there is no backend.
 *
 * Writes are debounced and wrapped in try/catch: Safari in private mode throws
 * on `setItem`, and a thrown storage error must never take the app down with it.
 */

function emptyProfile(): Profile {
  return ProfileSchema.parse({
    version: 1,
    updatedAt: new Date().toISOString(),
    courses: {},
    playlists: {},
    recent: [],
  });
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

  // An unknown version means a newer build of the site wrote this. Leave it
  // untouched and say so, rather than migrating it into something lossy.
  const version = (parsed as { version?: unknown }).version;
  if (typeof version === 'number' && version !== 1) {
    return { profile: emptyProfile(), outcome: 'unsupported-version' };
  }

  const result = ProfileSchema.safeParse(parsed);
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

export type ProfileStore = {
  profile: Profile;
  outcome: LoadOutcome;
  /** True when storage holds a profile from a future version — the UI shows a banner. */
  locked: boolean;

  courseStatus: (id: string) => CourseStatus | null;
  isCourseFavorite: (id: string) => boolean;
  isPlaylistWatched: (id: string) => boolean;
  isPlaylistFavorite: (id: string) => boolean;

  cycleCourseStatus: (id: string) => void;
  setCourseStatus: (id: string, status: CourseStatus | null) => void;
  toggleCourseFavorite: (id: string) => void;
  togglePlaylistWatched: (id: string) => void;
  togglePlaylistFavorite: (id: string) => void;
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
  const update = (mutate: (draft: Profile) => void): void => {
    const current = get().profile;
    const next: Profile = {
      ...current,
      courses: { ...current.courses },
      playlists: { ...current.playlists },
      recent: [...current.recent],
      settings: { ...current.settings },
      updatedAt: new Date().toISOString(),
    };
    mutate(next);
    persist(next, get().locked);
    set({ profile: next });
  };

  return {
    profile: initial.profile,
    outcome: initial.outcome,
    locked: initial.outcome === 'unsupported-version',

    courseStatus: (id) => get().profile.courses[id]?.status ?? null,
    isCourseFavorite: (id) => get().profile.courses[id]?.favorite ?? false,
    isPlaylistWatched: (id) => get().profile.playlists[id]?.watched ?? false,
    isPlaylistFavorite: (id) => get().profile.playlists[id]?.favorite ?? false,

    cycleCourseStatus: (id) =>
      update((draft) => {
        const current = draft.courses[id];
        const index = STATUS_CYCLE.indexOf(current?.status ?? null);
        const status = STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length];
        draft.courses[id] = {
          status,
          favorite: current?.favorite ?? false,
          at: new Date().toISOString(),
        };
      }),

    setCourseStatus: (id, status) =>
      update((draft) => {
        const current = draft.courses[id];
        draft.courses[id] = {
          status,
          favorite: current?.favorite ?? false,
          at: new Date().toISOString(),
        };
      }),

    toggleCourseFavorite: (id) =>
      update((draft) => {
        const current = draft.courses[id];
        draft.courses[id] = {
          status: current?.status ?? null,
          favorite: !(current?.favorite ?? false),
          at: new Date().toISOString(),
        };
      }),

    togglePlaylistWatched: (id) =>
      update((draft) => {
        const current = draft.playlists[id];
        draft.playlists[id] = {
          watched: !(current?.watched ?? false),
          favorite: current?.favorite ?? false,
          at: new Date().toISOString(),
        };
      }),

    togglePlaylistFavorite: (id) =>
      update((draft) => {
        const current = draft.playlists[id];
        draft.playlists[id] = {
          watched: current?.watched ?? false,
          favorite: !(current?.favorite ?? false),
          at: new Date().toISOString(),
        };
      }),

    /** Re-opening a playlist moves it to the top rather than adding a duplicate. */
    recordRecent: (entry) =>
      update((draft) => {
        draft.recent = [
          { ...entry, at: new Date().toISOString() },
          ...draft.recent.filter((item) => item.id !== entry.id),
        ].slice(0, RECENT_LIMIT);
      }),

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
          draft.courses[id] = {
            status: incomingRank > existingRank ? entry.status : existing.status,
            favorite: existing.favorite || entry.favorite,
            at: entry.at > existing.at ? entry.at : existing.at,
          };
        }
        for (const [id, entry] of Object.entries(incoming.playlists)) {
          const existing = draft.playlists[id];
          draft.playlists[id] = existing
            ? {
                watched: existing.watched || entry.watched,
                favorite: existing.favorite || entry.favorite,
                at: entry.at > existing.at ? entry.at : existing.at,
              }
            : entry;
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

/** Applies the theme setting to <html> so CSS variables switch. */
export function applyTheme(theme: Profile['settings']['theme']): void {
  const dark =
    theme === 'dark' ||
    (theme === 'auto' && !window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
