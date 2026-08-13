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

/* ────────────────────────  Interface language  ─────────────────────── */

/**
 * The languages the interface speaks.
 *
 * The catalogue itself is written once, in `DEFAULT_LANG`: a course title is
 * content, and translating four hundred of them is a data job rather than a UI
 * one. The chrome around it is not — `data/i18n/{lang}.json` carries the `ui.*`
 * keys for every language here, and the build lays each one over the full
 * dictionary, so an English interface still names the courses it is showing.
 */
export const UiLang = z.enum(['ru', 'en']);
export type UiLang = z.infer<typeof UiLang>;

/** How each language names itself, plus the two letters the header switch shows. */
export const UI_LANGS: ReadonlyArray<{ id: UiLang; short: string; name: string }> = [
  { id: 'ru', short: 'RU', name: 'Русский' },
  { id: 'en', short: 'EN', name: 'English' },
];

/* ─────────────────────────────  Profile  ───────────────────────────── */

export const CourseStatus = z.enum(['in_progress', 'done']);
export type CourseStatus = z.infer<typeof CourseStatus>;

/**
 * How much of a lecture has to be behind you before it counts as watched.
 *
 * Not 100%: the last minutes of a recording are credits, a Q&A that trails off,
 * or a camera left running, and a progress bar that refuses to complete because
 * of them is a progress bar people stop trusting.
 */
export const VIDEO_DONE_FRACTION = 0.9;

export const ProfileSchema = z.object({
  version: z.literal(2),
  updatedAt: z.string(),
  courses: z
    .record(
      z.string(),
      z.object({
        status: CourseStatus.nullable().default(null),
        favorite: z.boolean().default(false),
        /**
         * Whether this status was set by hand.
         *
         * Watching lectures promotes a course on its own — started on the first
         * one, finished when a whole playlist is behind you — and without this
         * flag there would be no way to disagree: clearing a status the player
         * would immediately set again is not a choice, it is a loop. Once
         * somebody has answered the question themselves, the automation stops
         * asking it.
         */
        manual: z.boolean().default(false),
        at: z.string(),
      })
    )
    .default({}),
  playlists: z
    .record(
      z.string(),
      z.object({
        /**
         * The seal: "all of this is behind me", set by hand.
         *
         * It deliberately writes no per-lecture marks — a playlist here runs to
         * 1192 videos — so taking it off uncovers whatever was actually watched
         * underneath rather than wiping it. Everything that asks "is this
         * finished" asks `playlistProgress`, which is this or a full house of
         * ticks, whichever comes first.
         */
        watched: z.boolean().default(false),
        favorite: z.boolean().default(false),
        /** Where to drop somebody back in — the last lecture they had playing. */
        lastVideoId: z.string().optional(),
        /**
         * Which course this playlist is for.
         *
         * Denormalised on purpose, and it earns it: it is the only way to know
         * that a course has any lecture progress *without* fetching its shard.
         * A path of nine courses would otherwise have to pull nine files —
         * some of them three quarters of a megabyte — every time a panel opens,
         * to discover that eight of them have nothing in them.
         *
         * Optional because a version 1 profile has no idea, and a playlist
         * whose course is unknown simply behaves as it did before.
         */
        courseId: z.string().optional(),
        at: z.string(),
      })
    )
    .default({}),
  /**
   * Lectures, keyed by YouTube id rather than by playlist.
   *
   * The same lecture turns up in a full course and in somebody's selection of
   * six highlights, and watching it once is watching it once. Global keys make
   * that true for free; per-playlist keys would make it a reconciliation
   * problem.
   *
   * `sec` is where playback stopped and disappears once the lecture is done —
   * a finished lecture has nowhere to resume from, and the bytes are better
   * spent on the ones that are not.
   */
  videos: z
    .record(
      z.string(),
      z.object({
        sec: z.number().optional(),
        done: z.boolean().default(false),
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
      // `catch` rather than `default`: a profile carrying a language this build
      // no longer ships would otherwise fail the whole parse and be read as
      // corrupt, losing every mark in it over one string.
      lang: UiLang.catch('ru'),
      theme: z.enum(['auto', 'light', 'dark']).default('auto'),
      splitRatio: z.number().min(0.3).max(0.8).default(0.62),
      /**
       * Hide everything past this stage. A setting rather than a URL parameter:
       * it says something about the reader, not about the view being shared, so
       * it should hold across domains and across sessions.
       */
      maxStage: Stage.nullable().default(null),
      /**
       * Whether the phone sheet opens with the course's links and path
       * unfolded. Closed to start with: the sheet is opened to find something
       * to watch, and three sections of neighbouring courses used to stand
       * between its first screen and the playlists. One answer for every
       * course, so the fold is not re-argued on each one — and none of this
       * reaches the wide panel, which has the height and never folds.
       *
       * `catch` rather than `default`, like `lang`: a value this build no
       * longer knows must not fail the parse and cost the reader every mark in
       * the profile over one string.
       */
      panelLinks: z.enum(['open', 'closed']).catch('closed'),
      /**
       * Whether the player remembers where you stopped.
       *
       * On by default, and worth a switch anyway: a site that quietly records
       * the minute you paused at is a site some people would rather tell to
       * stop. Only the position goes — which lectures are behind you is the
       * progress itself, and turning that off would be turning the feature off.
       */
      resume: z.boolean().catch(true),
    })
    .default({
      lang: 'ru',
      theme: 'auto',
      splitRatio: 0.62,
      maxStage: null,
      panelLinks: 'closed',
      resume: true,
    }),
});
export type Profile = z.infer<typeof ProfileSchema>;
export type RecentEntry = Profile['recent'][number];
export type VideoMark = Profile['videos'][string];

/** Long enough to cover "what was that lecture last month", short enough to stay in localStorage. */
export const RECENT_LIMIT = 60;

/**
 * The storage slot. Still says `v1` because it names the slot rather than the
 * shape in it — `version` inside does that — and renaming it would strand every
 * profile already written.
 */
export const PROFILE_KEY = 'catalog.profile.v1';

/** The shape this build writes. Anything higher was written by a newer site. */
export const PROFILE_VERSION = 2;

/**
 * A stored profile brought up to the current shape.
 *
 * Version 1 knew nothing of lectures: it had a tick per course and a tick per
 * playlist, and both mean exactly what they still mean, so the migration is
 * only the version number — every field added since has a default, and zod
 * fills them in. Returned as unknown rather than parsed here, so the caller
 * keeps one parse and one place that decides what a failed parse means.
 */
export function migrateProfile(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const version = (raw as { version?: unknown }).version;
  if (version !== 1) return raw;

  // Every status in a version 1 profile was pressed by hand — there was no
  // other way to set one — so they all carry the flag that keeps the new
  // automation from re-deciding them.
  const courses = (raw as { courses?: Record<string, object> }).courses ?? {};
  const claimed = Object.fromEntries(
    Object.entries(courses).map(([id, entry]) => [id, { ...entry, manual: true }])
  );

  return { ...(raw as object), version: PROFILE_VERSION, courses: claimed };
}

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
