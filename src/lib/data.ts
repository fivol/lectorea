import type {
  BuiltCourse,
  BuiltDomain,
  BuiltPlaylist,
  BuiltProvider,
  Meta,
  SearchEntry,
} from '@shared/schema';
import type { Dictionary } from '@/i18n';

/**
 * Loading the generated catalogue.
 *
 * The first screen pulls ~50 KB, not the whole database: playlists are sharded
 * one file per course and fetched when a course is opened, then kept in memory.
 */

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export type CoursesFile = {
  bounds: { width: number; height: number };
  maxLevel: number;
  courses: BuiltCourse[];
};

export type Catalog = {
  domains: BuiltDomain[];
  domainById: Map<string, BuiltDomain>;
  courses: BuiltCourse[];
  courseById: Map<string, BuiltCourse>;
  bounds: { width: number; height: number };
  maxLevel: number;
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

  return {
    domains,
    domainById: new Map(domains.map((d) => [d.id, d])),
    courses: coursesFile.courses,
    courseById: new Map(coursesFile.courses.map((c) => [c.id, c])),
    bounds: coursesFile.bounds,
    maxLevel: coursesFile.maxLevel,
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
