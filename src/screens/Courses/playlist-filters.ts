import {
  measuredRetention,
  playlistTypeOf,
  type BuiltPlaylist,
  type BuiltProvider,
  type LectureLength,
  type PlaylistType,
  type Profile,
  type ProviderType,
} from '@shared/schema';
import { playlistProgress } from '@/lib/progress';

/** Filter and sort state for the playlist list. Lives in the panel, not the URL. */

export type PlaylistFilterState = {
  langs: string[];
  providers: string[];
  providerTypes: ProviderType[];
  lecturer: string;
  videoCount: [number, number] | null;
  lectureLengths: LectureLength[];
  captions: 'any' | 'ru' | null;
  /** What the playlist is — «Подборка», «Семинары», «Полный курс», «Лекции». */
  types: PlaylistType[];
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
  types: [],
  fullOnly: false,
  years: null,
  hideWatched: false,
  onlyFavorite: false,
};

/** A language names itself: the chip says «Русский» whichever language the interface is in. */
export const LANG_LABELS: Record<string, string> = { ru: 'Русский', en: 'English' };

/**
 * The language filter starts on the language the interface is in, and stays on
 * it even for a course that has nothing in that language.
 *
 * Dropping the filter in that case used to keep the list from looking empty,
 * but it also hid the fact that there is not a single recording in your
 * language — the list simply appeared, in English, with no filter to explain
 * it. The list now says so itself and shows the other languages underneath
 * (see PlaylistList), so the filter can stay where the user put it.
 */
export function defaultFilters(lang: string): PlaylistFilterState {
  return { ...EMPTY_FILTERS, langs: [lang] };
}

/** «Русский, English» — what the filter is currently asking for, in one line. */
export function langLabel(langs: string[]): string {
  return langs.map((lang) => LANG_LABELS[lang] ?? lang).join(', ');
}

/**
 * What language to print on a row, if any.
 *
 * A list filtered down to one language is a list where every row says the same
 * thing, and a column of «ru» down the side of it is forty repetitions of the
 * chip already sitting above the list. So the language appears only when it
 * separates anything: when the filter admits more than one, when it admits none
 * and the list is whatever the course has, or — the case worth catching — when
 * this row is not in the language that was asked for, which happens when a
 * course has nothing in it and the list says so and shows the rest.
 */
export function languageLabel(lang: string, selected: string[]): string | null {
  if (selected.length === 1 && selected[0] === lang) return null;
  return LANG_LABELS[lang] ?? lang;
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
  if (state.types.length) n += 1;
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
  // A name picked off the list, not something typed: the field above it is a
  // way to find a row, and only a row sets this. Matched whole, because 14
  // names in the catalogue contain another one — «Сорокин» would otherwise
  // bring «Сорокин А.А.» along with it.
  const lecturer = state.lecturer.trim();

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
    if (lecturer && playlist.lecturer !== lecturer) return false;
    if (state.videoCount) {
      const [min, max] = state.videoCount;
      if (playlist.videoCount < min || playlist.videoCount > max) return false;
    }
    if (state.lectureLengths.length && !state.lectureLengths.includes(playlist.lectureLength)) {
      return false;
    }
    if (state.captions === 'any' && !playlist.captions.length) return false;
    if (state.captions === 'ru' && !playlist.captions.includes('ru')) return false;
    if (state.types.length && !state.types.includes(playlistTypeOf(playlist))) return false;
    // `completeness` used to answer this, and it answered it for 77% of the
    // catalogue: a regex over the title plus «twelve videos or more». The
    // structural test is the honest one — see `isFullCourse`.
    if (state.fullOnly && !playlist.fullCourse) return false;
    if (state.years) {
      const [min, max] = state.years;
      if (!playlist.year || playlist.year < min || playlist.year > max) return false;
    }
    // Every lecture ticked counts as watched even without the seal on top —
    // otherwise the filter hides the playlists you sealed and keeps the ones
    // you actually sat through.
    if (state.hideWatched && playlistProgress(profile, playlist).complete) return false;
    if (state.onlyFavorite && !profile.playlists[playlist.id]?.favorite) return false;
    return true;
  });
}

export const SORT_KEYS = [
  'rating',
  'retention',
  'views',
  'viewsPerLecture',
  'engagement',
  'year',
  'duration',
  'videoCount',
] as const;

export type SortKey = (typeof SORT_KEYS)[number];

type Rank = (playlist: BuiltPlaylist) => number;

const SORTERS: Record<SortKey, Rank> = {
  rating: (p) => p.rating,
  // The number the row prints, and only when the row is willing to print it —
  // see `measuredRetention`. A playlist with no answer sits below every playlist
  // that has one rather than in the middle of them.
  retention: (p) => measuredRetention(p) ?? -1,
  views: (p) => p.stats.views,
  // Normalises long courses: a 60-lecture series and a 6-lecture one are not
  // comparable on raw views.
  viewsPerLecture: (p) => (p.videoCount ? p.stats.views / p.videoCount : 0),
  engagement: (p) => p.engagement,
  year: (p) => p.year ?? 0,
  duration: (p) => p.totalSeconds,
  videoCount: (p) => p.videoCount,
};

/**
 * A second opinion for keys whose first one ties, consulted before the title.
 *
 * Retention needs one because the ratio it sorts on is clamped: 15 playlists in
 * the catalogue sit at the 300% ceiling together, and dozens more meet at a
 * rounded percent. `signals.retention` is the same quantity scored — compared
 * against peers and shrunk towards the middle by how few views it rests on — so
 * among playlists the reader cannot tell apart it puts the better-evidenced one
 * first. It is never the primary sort: the list would then run out of order
 * against the percentages printed down it, which is worse than a tie.
 */
const TIEBREAKERS: Partial<Record<SortKey, Rank>> = {
  retention: (p) => p.signals.retention ?? 0,
};

export function sortPlaylists(playlists: BuiltPlaylist[], key: SortKey): BuiltPlaylist[] {
  const value = SORTERS[key];
  const tie = TIEBREAKERS[key];
  return [...playlists].sort(
    (a, b) => value(b) - value(a) || (tie ? tie(b) - tie(a) : 0) || a.title.localeCompare(b.title)
  );
}

/** Distinct values present in this course's playlists — filters offer only these. */
export function facetsOf(playlists: BuiltPlaylist[]) {
  const langs = new Set<string>();
  const providers = new Set<string>();
  // Counted, not just collected: the filter offers them before anything is
  // typed, and the one with six recordings is a better first row than the one
  // whose name happens to start with «А».
  const lecturers = new Map<string, number>();
  let minCount = Infinity;
  let maxCount = 0;
  let minYear = Infinity;
  let maxYear = 0;

  for (const playlist of playlists) {
    langs.add(playlist.lang);
    providers.add(playlist.providerId);
    if (playlist.lecturer) {
      lecturers.set(playlist.lecturer, (lecturers.get(playlist.lecturer) ?? 0) + 1);
    }
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
    lecturers: [...lecturers]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name),
    countRange: Number.isFinite(minCount) ? ([minCount, maxCount] as [number, number]) : null,
    yearRange: Number.isFinite(minYear) ? ([minYear, maxYear] as [number, number]) : null,
  };
}
