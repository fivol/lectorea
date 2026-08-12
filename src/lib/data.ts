import type {
  BuiltCourse,
  BuiltDomain,
  BuiltPlaylist,
  BuiltProvider,
  Meta,
  SearchEntry,
} from '@shared/schema';
import { dependantsIndex, forwardClosureSizes } from '@shared/graph';
import type { Dictionary } from '@/i18n';

/**
 * Loading the generated catalogue.
 *
 * The first screen pulls ~50 KB, not the whole database: playlists are sharded
 * one file per course and fetched when a course is opened, then kept in memory.
 */

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export type Column = { level: number; count: number };

export type CoursesFile = {
  maxLevel: number;
  columns: Column[];
  courses: BuiltCourse[];
};

export type Catalog = {
  domains: BuiltDomain[];
  domainById: Map<string, BuiltDomain>;
  courses: BuiltCourse[];
  courseById: Map<string, BuiltCourse>;
  /** Column descriptors, ascending by level. The screen renders one each. */
  columns: Column[];
  maxLevel: number;
  /** courseId → the courses that list it in `deps`. */
  dependants: Map<string, string[]>;
  /** courseId → how many courses open up behind it, transitively. */
  behind: Map<string, number>;
  providers: Record<string, BuiltProvider>;
  /** The whole search index: the language-neutral half plus the current language's. */
  search: SearchEntry[];
  meta: Meta;
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${base}/data/${path}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}

export type Language = {
  lang: string;
  dict: Dictionary;
  /** Course and field entries for the search index, named in this language. */
  search: SearchEntry[];
};

/**
 * What changes when the interface language does, and nothing else.
 *
 * Two small files rather than the whole catalogue: the dictionary, and the half
 * of the search index that is written in a language. Switching language costs
 * those and nothing on screen has to be torn down.
 */
export async function loadLanguage(lang: string): Promise<Language> {
  const [dict, search] = await Promise.all([
    getJson<Dictionary>(`i18n/${lang}.json`),
    getJson<SearchEntry[]>(`i18n/search-${lang}.json`),
  ]);
  return { lang, dict, search };
}

export async function loadCatalog(): Promise<Catalog> {
  const [domains, coursesFile, providers, search, meta] = await Promise.all([
    getJson<BuiltDomain[]>('domains.json'),
    getJson<CoursesFile>('courses.json'),
    getJson<Record<string, BuiltProvider>>('providers.json'),
    // Playlists, channels and lecturers only — the language half arrives with
    // the dictionary and is merged in by `CatalogProvider`.
    getJson<SearchEntry[]>('search-index.json'),
    getJson<Meta>('meta.json'),
  ]);

  // Transitive closures are not shipped — they would be ~100 KB of JSON for
  // something that is two walks over 200 nodes here. `courses` arrives in
  // topological order, which is exactly what `forwardClosureSizes` needs.
  const courses = coursesFile.courses;
  const order = courses.map((course) => course.id);

  return {
    domains,
    domainById: new Map(domains.map((d) => [d.id, d])),
    courses,
    courseById: new Map(courses.map((c) => [c.id, c])),
    columns: coursesFile.columns,
    maxLevel: coursesFile.maxLevel,
    dependants: dependantsIndex(courses),
    behind: forwardClosureSizes(courses, order),
    providers,
    search,
    meta,
  };
}

/* ─────────────────────────────  Playlist shards  ───────────────────────── */

const shardCache = new Map<string, Promise<BuiltPlaylist[]>>();

export function loadPlaylists(courseId: string): Promise<BuiltPlaylist[]> {
  const cached = shardCache.get(courseId);
  if (cached) return cached;

  const request = fetch(`${base}/data/playlists/${courseId}.json`)
    .then((response) => {
      // A course with no materials simply has no shard; that is not an error.
      if (response.status === 404) return [] as BuiltPlaylist[];
      if (!response.ok) throw new Error(`Failed to load playlists for ${courseId}`);
      return response.json() as Promise<BuiltPlaylist[]>;
    })
    .catch(() => [] as BuiltPlaylist[]);

  shardCache.set(courseId, request);
  return request;
}

/** Already-resolved shards, for code that must stay synchronous (profile totals). */
const shardValues = new Map<string, BuiltPlaylist[]>();

export async function loadPlaylistsCached(courseId: string): Promise<BuiltPlaylist[]> {
  const value = await loadPlaylists(courseId);
  shardValues.set(courseId, value);
  return value;
}

export function peekPlaylists(courseId: string): BuiltPlaylist[] | undefined {
  return shardValues.get(courseId);
}

/**
 * Which drawing of the world: the continents ranged side by side, or stacked.
 *
 * Two files, one catalogue. Both come out of the same generator — see
 * `pnpm map:portrait` — so a domain added to `domains.yaml` lands on both, and
 * neither is a picture anybody has to redraw by hand.
 */
export type MapVariant = 'wide' | 'portrait';

const MAP_FILE: Record<MapVariant, string> = {
  wide: 'map.svg',
  portrait: 'map-portrait.svg',
};

export async function loadMapSvg(variant: MapVariant = 'wide'): Promise<string> {
  const file = MAP_FILE[variant];
  const response = await fetch(`${base}/${file}`);
  if (!response.ok) throw new Error(`Failed to load ${file}`);
  return response.text();
}
