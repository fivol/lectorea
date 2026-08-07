import { z } from 'zod';

/**
 * The single source of truth for every shape that crosses a boundary:
 * hand-written YAML, the build pipeline, the generated JSON, the frontend.
 *
 * Two families live here:
 *   *Schema         — sources, edited by hand and reviewed in PRs
 *   Built*Schema    — sources plus fields computed by `08-build.ts`
 */

/* ─────────────────────────────  Domains  ───────────────────────────── */

export const Continent = z.enum(['formal', 'social', 'humanities']);
export type Continent = z.infer<typeof Continent>;

export const DomainSchema = z.object({
  id: z.string(), // 'math', 'bioinformatics'
  continent: Continent,
  parent: z.string().optional(), // for sub-domains
  bridge: z.boolean().default(false), // interdisciplinary domain in a strait
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/), // hex, base of the palette
  shapeId: z.string(), // id of the <path> in map.svg
  dependsOn: z.array(z.string()).default([]), // source domains (for highlighting)
  image: z.string().optional(), // path to a generated image
});
export type Domain = z.infer<typeof DomainSchema>;

export const BuiltDomainSchema = DomainSchema.extend({
  courseCount: z.number(),
  playlistCount: z.number(),
  /** Median course level inside the domain — used to sort blocks view. */
  hours: z.number(),
});
export type BuiltDomain = z.infer<typeof BuiltDomainSchema>;

/* ─────────────────────────────  Courses  ───────────────────────────── */

export const CourseSchema = z.object({
  id: z.string(), // 'probability', 'calculus-1'
  domains: z.array(z.string()).min(1), // the first one is primary
  deps: z.array(z.string()).default([]),
  soft: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  externalRefs: z
    .object({
      // Where the dependency markup came from. Reviewers check these.
      syllabus: z.string().url().optional(),
    })
    .optional(),
});
export type Course = z.infer<typeof CourseSchema>;

/** One step of `reachDown`: a course this one unlocks, plus how much sits behind it. */
export const ReachDownStepSchema = z.object({
  id: z.string(),
  /** How many further courses become reachable through this one. */
  behind: z.number(),
});

export const BuiltCourseSchema = CourseSchema.extend({
  level: z.number(), // longest `deps` chain ending here, computed globally
  x: z.number(),
  y: z.number(),
  playlistCount: z.number(),
  hours: z.number(), // median totalSeconds of the course playlists, in hours
  reachUp: z.array(z.string()), // transitive `deps` closure, topologically ordered
  reachDown: z.array(ReachDownStepSchema), // first step forward + counter
});
export type BuiltCourse = z.infer<typeof BuiltCourseSchema>;

/* ────────────────────────────  Providers  ──────────────────────────── */

export const ProviderType = z.enum(['university', 'platform', 'individual']);
export type ProviderType = z.infer<typeof ProviderType>;

export const ProviderSchema = z.object({
  id: z.string(), // 'mit', 'hse', 'msu', 'savvateev'
  title: z.string(), // not localised — proper names stay as they are
  type: ProviderType,
  country: z.string().optional(),
  site: z.string().url().optional(),
});
export type Provider = z.infer<typeof ProviderSchema>;

export const BuiltProviderSchema = ProviderSchema.extend({
  playlistCount: z.number(),
  courseIds: z.array(z.string()),
  domainIds: z.array(z.string()),
});
export type BuiltProvider = z.infer<typeof BuiltProviderSchema>;

/* ────────────────────────────  Playlists  ──────────────────────────── */

export const PlaylistKind = z.enum(['lectures', 'seminars', 'mixed', 'unknown']);
export type PlaylistKind = z.infer<typeof PlaylistKind>;
export const Completeness = z.enum(['full', 'partial', 'unknown']);
export type Completeness = z.infer<typeof Completeness>;
export const LectureLength = z.enum(['lesson', 'pair', 'double', 'long']);
export type LectureLength = z.infer<typeof LectureLength>;

export const PlaylistSchema = z.object({
  id: z.string(), // youtube playlist id
  courseId: z.string(),
  title: z.string(), // as on YouTube, never localised
  channelId: z.string(),
  channelTitle: z.string(),
  providerId: z.string(), // 'mit', 'hse', 'msu', 'savvateev'
  lecturer: z.string().optional(),
  lang: z.string(), // 'ru', 'en'
  captions: z.array(z.string()).default([]), // caption languages
  year: z.number().optional(), // recording year, from the first video's date
  videoCount: z.number(),
  totalSeconds: z.number(),
  medianSeconds: z.number(),
  kind: PlaylistKind,
  completeness: Completeness,
  stats: z.object({
    views: z.number(),
    likes: z.number(),
    comments: z.number(),
    fetchedAt: z.string(),
  }),
  alive: z.boolean(),
  checkedAt: z.string(),
});
export type Playlist = z.infer<typeof PlaylistSchema>;

export const VideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  seconds: z.number(),
});
export type Video = z.infer<typeof VideoSchema>;

export const BuiltPlaylistSchema = PlaylistSchema.extend({
  lectureLength: LectureLength,
  engagement: z.number(),
  score: z.number(), // bayesian rating, see SPEC 1.5
  /** `score` mapped onto 0..100 against the catalogue mean, for the quality dot. */
  scorePercent: z.number(),
  /** Lecture list, shipped with the shard so the modal needs no API call. */
  videos: z.array(VideoSchema).default([]),
});
export type BuiltPlaylist = z.infer<typeof BuiltPlaylistSchema>;

/* ─────────────────────────────  Overrides  ─────────────────────────── */

/** Hand edits applied on top of the automatic pipeline. Committed to git. */
export const OverridesSchema = z.object({
  /** playlistId → courseId, or `null` to say "this is not a course". */
  matches: z.record(z.string(), z.string().nullable()).default({}),
  /** playlistId → partial playlist fields that win over scraped values. */
  playlists: z
    .record(
      z.string(),
      PlaylistSchema.partial().omit({ id: true, courseId: true }).extend({
        lecturer: z.string().optional(),
        hidden: z.boolean().optional(),
      })
    )
    .default({}),
  /** channelId → providerId, when the channel title is not enough. */
  channels: z.record(z.string(), z.string()).default({}),
});
export type Overrides = z.infer<typeof OverridesSchema>;

export const ChannelSchema = z.object({
  id: z.string(), // youtube channel id (UC...)
  title: z.string(),
  providerId: z.string(),
  lang: z.string().default('ru'),
});
export type Channel = z.infer<typeof ChannelSchema>;

/* ───────────────────────────  Search index  ────────────────────────── */

export const SearchEntryType = z.enum(['d', 'c', 'p', 'v', 'l']);
// domain / course / playlist / vendor / lecturer

export const SearchEntrySchema = z.object({
  t: SearchEntryType,
  id: z.string(),
  n: z.string(), // display name
  k: z.array(z.string()), // keywords, already expanded
  s: z.number().optional(), // ranking weight
  c: z.string().optional(), // owning course, for playlist entries
});
export type SearchEntry = z.infer<typeof SearchEntrySchema>;

/* ──────────────────────────────  Meta  ─────────────────────────────── */

export const MetaSchema = z.object({
  version: z.string(),
  builtAt: z.string(),
  courses: z.number(),
  domains: z.number(),
  playlists: z.number(),
  providers: z.number(),
  /** Share of courses that have at least one live playlist. 0..1 */
  coverage: z.number(),
  maxLevel: z.number(),
});
export type Meta = z.infer<typeof MetaSchema>;

/* ─────────────────────────────  Profile  ───────────────────────────── */

export const CourseStatus = z.enum(['in_progress', 'done']);
export type CourseStatus = z.infer<typeof CourseStatus>;

export const ProfileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  courses: z
    .record(
      z.string(),
      z.object({
        status: CourseStatus.nullable().default(null),
        favorite: z.boolean().default(false),
        at: z.string(),
      })
    )
    .default({}),
  playlists: z
    .record(
      z.string(),
      z.object({
        watched: z.boolean().default(false),
        favorite: z.boolean().default(false),
        at: z.string(),
      })
    )
    .default({}),
  settings: z
    .object({
      lang: z.string().default('ru'),
      theme: z.enum(['auto', 'light', 'dark']).default('auto'),
      mapView: z.enum(['map', 'blocks']).default('map'),
      splitRatio: z.number().min(0.3).max(0.8).default(0.62),
    })
    .default({
      lang: 'ru',
      theme: 'auto',
      mapView: 'map',
      splitRatio: 0.62,
    }),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const PROFILE_KEY = 'catalog.profile.v1';

/* ────────────────────────────  Constants  ──────────────────────────── */

/** Bayesian smoothing threshold, in views. See SPEC 1.5. */
export const SCORE_CONFIDENCE_VIEWS = 5000;

/** Lecture length buckets, in seconds. */
export const LECTURE_BUCKETS: Array<{ id: LectureLength; maxSeconds: number }> = [
  { id: 'lesson', maxSeconds: 40 * 60 },
  { id: 'pair', maxSeconds: 100 * 60 },
  { id: 'double', maxSeconds: 200 * 60 },
  { id: 'long', maxSeconds: Infinity },
];

export function lectureLengthOf(medianSeconds: number): LectureLength {
  return LECTURE_BUCKETS.find((b) => medianSeconds <= b.maxSeconds)!.id;
}
