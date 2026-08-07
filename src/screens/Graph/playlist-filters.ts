import type {
  BuiltPlaylist,
  BuiltProvider,
  LectureLength,
  Profile,
  ProviderType,
} from '@shared/schema';

/** Filter and sort state for the playlist list. Lives in the panel, not the URL. */

export type PlaylistFilterState = {
  langs: string[];
  providers: string[];
  providerTypes: ProviderType[];
  lecturer: string;
  videoCount: [number, number] | null;
  lectureLengths: LectureLength[];
  captions: 'any' | 'ru' | null;
  kinds: BuiltPlaylist['kind'][];
  fullOnly: boolean;
  years: [number, number] | null;
  hideWatched: boolean;
  onlyFavorite: boolean;
};

export const EMPTY_FILTERS: PlaylistFilterState = {
  langs: [],
  providers: [],
  providerTypes: [],
  lecturer: '',
  videoCount: null,
  lectureLengths: [],
  captions: null,
  kinds: [],
  fullOnly: false,
  years: null,
  hideWatched: false,
  onlyFavorite: false,
};

/**
 * The language filter defaults to `ru` — but only when the course actually has
 * Russian materials. Defaulting unconditionally would show an empty list for
 * every course whose only recordings are in English, which reads as a bug.
 */
export function defaultFilters(playlists: BuiltPlaylist[]): PlaylistFilterState {
  const hasRussian = playlists.some((playlist) => playlist.lang === 'ru');
  return { ...EMPTY_FILTERS, langs: hasRussian ? ['ru'] : [] };
}

export function activeFilterCount(state: PlaylistFilterState): number {
  let n = 0;
  if (state.langs.length) n += 1;
  if (state.providers.length) n += 1;
  if (state.providerTypes.length) n += 1;
  if (state.lecturer.trim()) n += 1;
  if (state.videoCount) n += 1;
  if (state.lectureLengths.length) n += 1;
  if (state.captions) n += 1;
  if (state.kinds.length) n += 1;
  if (state.fullOnly) n += 1;
  if (state.years) n += 1;
  if (state.hideWatched) n += 1;
  if (state.onlyFavorite) n += 1;
  return n;
}

export type GlobalFilter = {
  providers: string[];
  lecturers: string[];
};

export function applyFilters(
  playlists: BuiltPlaylist[],
  state: PlaylistFilterState,
  profile: Profile,
  global: GlobalFilter,
  providersById: Record<string, BuiltProvider>
): BuiltPlaylist[] {
  const lecturerNeedle = state.lecturer.trim().toLowerCase();

  return playlists.filter((playlist) => {
    // The global provider/lecturer filter lives above the whole app and is
    // combined with OR inside itself, AND against the local filters.
    if (global.providers.length && !global.providers.includes(playlist.providerId)) return false;
    if (global.lecturers.length && (!playlist.lecturer || !global.lecturers.includes(playlist.lecturer))) {
      return false;
    }

    if (state.langs.length && !state.langs.includes(playlist.lang)) return false;
    if (state.providers.length && !state.providers.includes(playlist.providerId)) return false;
    if (state.providerTypes.length) {
      const type = providersById[playlist.providerId]?.type;
      if (!type || !state.providerTypes.includes(type)) return false;
    }
    if (lecturerNeedle && !playlist.lecturer?.toLowerCase().includes(lecturerNeedle)) return false;
    if (state.videoCount) {
      const [min, max] = state.videoCount;
      if (playlist.videoCount < min || playlist.videoCount > max) return false;
    }
    if (state.lectureLengths.length && !state.lectureLengths.includes(playlist.lectureLength)) {
      return false;
    }
    if (state.captions === 'any' && !playlist.captions.length) return false;
    if (state.captions === 'ru' && !playlist.captions.includes('ru')) return false;
    if (state.kinds.length && !state.kinds.includes(playlist.kind)) return false;
    if (state.fullOnly && playlist.completeness !== 'full') return false;
    if (state.years) {
      const [min, max] = state.years;
      if (!playlist.year || playlist.year < min || playlist.year > max) return false;
    }
    if (state.hideWatched && profile.playlists[playlist.id]?.watched) return false;
    if (state.onlyFavorite && !profile.playlists[playlist.id]?.favorite) return false;
    return true;
  });
}

export const SORT_KEYS = [
  'score',
  'views',
  'viewsPerLecture',
  'engagement',
  'year',
  'duration',
  'videoCount',
] as const;

export type SortKey = (typeof SORT_KEYS)[number];

const SORTERS: Record<SortKey, (playlist: BuiltPlaylist) => number> = {
  score: (p) => p.score,
  views: (p) => p.stats.views,
  // Normalises long courses: a 60-lecture series and a 6-lecture one are not
  // comparable on raw views.
  viewsPerLecture: (p) => (p.videoCount ? p.stats.views / p.videoCount : 0),
  engagement: (p) => p.engagement,
  year: (p) => p.year ?? 0,
  duration: (p) => p.totalSeconds,
  videoCount: (p) => p.videoCount,
};

export function sortPlaylists(playlists: BuiltPlaylist[], key: SortKey): BuiltPlaylist[] {
  const value = SORTERS[key];
  return [...playlists].sort((a, b) => value(b) - value(a) || a.title.localeCompare(b.title));
}

/** Distinct values present in this course's playlists — filters offer only these. */
export function facetsOf(playlists: BuiltPlaylist[]) {
  const langs = new Set<string>();
  const providers = new Set<string>();
  const lecturers = new Set<string>();
  let minCount = Infinity;
  let maxCount = 0;
  let minYear = Infinity;
  let maxYear = 0;

  for (const playlist of playlists) {
    langs.add(playlist.lang);
    providers.add(playlist.providerId);
    if (playlist.lecturer) lecturers.add(playlist.lecturer);
    minCount = Math.min(minCount, playlist.videoCount);
    maxCount = Math.max(maxCount, playlist.videoCount);
    if (playlist.year) {
      minYear = Math.min(minYear, playlist.year);
      maxYear = Math.max(maxYear, playlist.year);
    }
  }

  return {
    langs: [...langs].sort(),
    providers: [...providers].sort(),
    lecturers: [...lecturers].sort(),
    countRange: Number.isFinite(minCount) ? ([minCount, maxCount] as [number, number]) : null,
    yearRange: Number.isFinite(minYear) ? ([minYear, maxYear] as [number, number]) : null,
  };
}
