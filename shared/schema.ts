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

/**
 * A domain as `data/domains.yaml` writes it: everything a person decides about
 * a field of knowledge except how it looks.
 *
 * The colour is deliberately absent. It belongs to the field's biome — see
 * `shared/tiles/biomes.ts`, where the ground a territory is made of and the
 * colour it is painted are one line — and a second copy here would be one more
 * thing to keep in step for no gain. `loadSources()` fills it in, so everything
 * downstream still reads `domain.color`.
 */
export const SourceDomainSchema = z.object({
  id: z.string(), // 'math', 'bioinformatics'
  continent: Continent,
  parent: z.string().optional(), // for sub-domains
  bridge: z.boolean().default(false), // interdisciplinary domain in a strait
  shapeId: z.string(), // id of the <path> in map.svg
  dependsOn: z.array(z.string()).default([]), // source domains (for highlighting)
  image: z.string().optional(), // path to a generated image
  /**
   * Vertical order of the domain's band in the course columns, fundamental at
   * the top. Written by hand: derived from anything else it would drift between
   * builds and shuffle the whole screen on an unrelated edit.
   */
  bandOrder: z.number().int(),
});
export type SourceDomain = z.infer<typeof SourceDomainSchema>;

/** The same domain once the loader has given it the colour of its biome. */
export const DomainSchema = SourceDomainSchema.extend({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/), // hex, base of the palette
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

/**
 * Where in an education this course normally falls.
 *
 * Deliberately not derived from `level`: the two answer different questions.
 * `level` counts prerequisites inside this catalogue, so "Введение в
 * социологию" and "Школьная алгебра" both sit at zero while one is a first-year
 * university course and the other is school. This is a curator's judgement and
 * lives in the data where it can be argued with.
 */
export const Stage = z.enum([
  'school-8',
  'school-9',
  'school-10',
  'school-11',
  'bachelor-1',
  'bachelor-2',
  'bachelor-3',
  'bachelor-4',
  'master-1',
  'master-2',
  'phd',
]);
export type Stage = z.infer<typeof Stage>;

/** School first, doctorate last — the order the enum is declared in. */
export const STAGE_ORDER = Stage.options;

export function stageRank(stage: Stage): number {
  return STAGE_ORDER.indexOf(stage);
}

/**
 * Structure only — no titles, no descriptions, no keywords. Those live in
 * `data/i18n/{lang}.json` under `course.{id}.*`, so that a diff on a course file
 * reads as a change to the graph instead of drowning in reworded prose.
 */
export const CourseSchema = z.object({
  id: z.string(), // 'probability', 'calculus-1'
  domains: z.array(z.string()).min(1), // the first one is primary; it picks the file
  stage: Stage, // where in an education this normally falls
  deps: z.array(z.string()).default([]),
  soft: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  /**
   * Manual floor under the computed level, for courses with no formal
   * prerequisites that column zero would misrepresent — art history does not
   * belong next to school algebra. Rare, and always with a comment saying why:
   * every use is an admission of a dependency that exists but is not written.
   */
  minLevel: z.number().int().min(0).optional(),
  refs: z
    .object({
      // Where the dependency markup came from. Reviewers check these.
      syllabus: z.string().url().optional(),
    })
    .optional(),
});
export type Course = z.infer<typeof CourseSchema>;

/**
 * Transitive closures are deliberately absent: `level` already guarantees
 * `level(dep) < level(course)`, so the client walks `deps` and sorts by level in
 * five lines. Shipping the closures would cost ~100 KB for that.
 */
export const BuiltCourseSchema = CourseSchema.extend({
  level: z.number(), // column: longest `deps` chain ending here, computed globally
  row: z.number(), // position inside the column, from the barycentric ordering
  playlistCount: z.number(),
  hours: z.number(), // median totalSeconds of the course playlists, in hours
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
  /**
   * Playlists that were opened, newest first.
   *
   * The title is stored rather than looked up: a playlist can be deleted from
   * YouTube or drop out of the catalogue, and "what did I watch last week"
   * should still answer, instead of quietly losing rows.
   */
  recent: z
    .array(
      z.object({
        id: z.string(),
        courseId: z.string(),
        title: z.string(),
        at: z.string(),
      })
    )
    .default([]),
  settings: z
    .object({
      lang: z.string().default('ru'),
      theme: z.enum(['auto', 'light', 'dark']).default('auto'),
      mapView: z.enum(['map', 'blocks']).default('map'),
      splitRatio: z.number().min(0.3).max(0.8).default(0.62),
      /**
       * Hide everything past this stage. A setting rather than a URL parameter:
       * it says something about the reader, not about the view being shared, so
       * it should hold across domains and across sessions.
       */
      maxStage: Stage.nullable().default(null),
    })
    .default({
      lang: 'ru',
      theme: 'auto',
      mapView: 'map',
      splitRatio: 0.62,
      maxStage: null,
    }),
});
export type Profile = z.infer<typeof ProfileSchema>;
export type RecentEntry = Profile['recent'][number];

/** Long enough to cover "what was that lecture last month", short enough to stay in localStorage. */
export const RECENT_LIMIT = 60;

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
