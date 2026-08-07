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
  search: SearchEntry[];
  meta: Meta;
  dict: Dictionary;
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${base}/data/${path}`);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function loadCatalog(lang: string): Promise<Catalog> {
  const [domains, coursesFile, providers, search, meta, dict] = await Promise.all([
    getJson<BuiltDomain[]>('domains.json'),
    getJson<CoursesFile>('courses.json'),
    getJson<Record<string, BuiltProvider>>('providers.json'),
    getJson<SearchEntry[]>('search-index.json'),
    getJson<Meta>('meta.json'),
    getJson<Dictionary>(`i18n/${lang}.json`),
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
    dict,
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

export async function loadMapSvg(): Promise<string> {
  const response = await fetch(`${base}/map.svg`);
  if (!response.ok) throw new Error('Failed to load map.svg');
  return response.text();
}

/** The painting the territories are drawn over — same coordinates as map.svg. */
export const mapImageUrl = `${base}/map.png`;
