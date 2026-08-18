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
  /**
   * A course with nothing to watch and nothing standing on it: it stays in the
   * file so the coverage report keeps seeing the hole, and the client drops it
   * before anything is drawn. Never set on a course some visible course needs —
   * a path may not lead through a card that is not there. See `docs/data.md`.
   */
  hidden: z.boolean().optional(),
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

/* ────────────────────────────  Lecturers  ──────────────────────────── */

/**
 * Who reads the course, and where their recordings are.
 *
 * Nobody declares these: the names are read off playlist titles by
 * `detectLecturer`, so a lecturer exists exactly as far as their recordings do.
 * They ship as their own small file for the same reason providers do — the
 * filter that names one lives above both screens and has to know which courses
 * and which fields it leaves standing without opening 170 playlist shards to
 * find out.
 */
export const BuiltLecturerSchema = z.object({
  /** The name as it is written on the recordings — also the key and the URL value. */
  name: z.string(),
  playlistCount: z.number(),
  courseIds: z.array(z.string()),
  domainIds: z.array(z.string()),
});
export type BuiltLecturer = z.infer<typeof BuiltLecturerSchema>;

/* ────────────────────────────  Playlists  ──────────────────────────── */

export const PlaylistKind = z.enum(['lectures', 'seminars', 'mixed', 'unknown']);
export type PlaylistKind = z.infer<typeof PlaylistKind>;
export const Completeness = z.enum(['full', 'partial', 'unknown']);
export type Completeness = z.infer<typeof Completeness>;
export const LectureLength = z.enum(['short', 'lesson', 'pair', 'double', 'long']);
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
  /**
   * Whether YouTube's player will take this playlist as `list=`.
   *
   * A handful of perfectly public playlists — Khan Academy's Linear Algebra
   * among them — are met with «This video is unavailable» when the id is passed
   * to the embed, while every video in them plays on its own. So the player
   * gets the playlist only when it is known to accept it, and the app walks the
   * lectures itself for the rest. Defaulted to `true` so a shard built before
   * the check existed behaves as it always did.
   */
  listPlayable: z.boolean().default(true),
  /**
   * Other courses this same recording also covers.
   *
   * A playlist belongs to one course in the ordinary case, and `courseId` is
   * that course. But «Алгоритмы и структуры данных» is one semester teaching
   * two of ours — 130 recordings say so, and 41 of them prove it in their
   * lecture titles — and filing it under one leaves the other empty of material
   * that exists. So the binding is a list, `courseId` is its first entry, and
   * the shard of every course in it carries the same playlist.
   */
  alsoCourses: z.array(z.string()).default([]),
});
export type Playlist = z.infer<typeof PlaylistSchema>;

/**
 * Where a recording sits in a run of them: «Часть 1», semester 2.
 *
 * A university that splits a subject publishes the halves as separate
 * playlists, and the catalogue has no way to tell them from three unrelated
 * recordings of the same course — of which it also has plenty. `key` is what
 * the halves share (one channel, one title with the part number taken out),
 * `pos` is the number found in the title. Detected in the build by
 * `scripts/lib/series.ts`, never stored in the crawl.
 *
 * There is deliberately no length. `total` used to hold the highest position in
 * the run and the list printed it — «Один курс, 4 части» — which is a claim
 * about how long somebody else's course is, made from the largest number we
 * managed to parse out of their titles. A run of «s3, s4» announced four parts
 * and showed two, and no arrangement of that number is honest: what the
 * catalogue has is these parts, and the reader can see them.
 */
export const SeriesSchema = z.object({
  key: z.string(),
  pos: z.number(),
  /** What the number was written as: «часть», «семестр», «сезон», «номер». */
  kind: z.string(),
});
export type Series = z.infer<typeof SeriesSchema>;

export const VideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  seconds: z.number(),
});
export type Video = z.infer<typeof VideoSchema>;

/**
 * Shape of a playlist's view curve — see `docs/rating.md`.
 *
 * `series` falls off along a power law: people watch it in order and drop out.
 * `assorted` has views unrelated to position: a subject bucket entered from
 * search at a random point, whose retention means nothing and is not scored.
 */
export const CurveKind = z.enum(['series', 'assorted', 'unclear']);
export type CurveKind = z.infer<typeof CurveKind>;

/**
 * What the numbers say about a playlist, and nothing else.
 *
 * Neutral or positive only: the data can say "loved and finished", it cannot
 * say "bad" — see `docs/rating.md` for why the negative half is deliberately
 * missing. `sparse` and `fresh` are not verdicts either; they are the two ways
 * of saying the verdict has been withheld, and they belong here because they
 * are statements about the rating rather than about the recording.
 *
 * What the playlist *is* — a shelf, a whole course, a term of seminars — used
 * to be said in this same word, and it was the wrong slot for it: «Подборка»
 * is not a mark out of ten, and while it sat at the head of the ladder it also
 * silenced the rating for the 440 playlists whose shape it described. That
 * question now has its own answer in `PlaylistType`.
 */
export const PlaylistStatus = z.enum([
  'sparse', // too few views to say anything
  'fresh', // still being uploaded, numbers not settled
  'excellent', // above the catalogue on approval and retention at once
  'retained', // watched to the end
  'liked', // unusually many likes per view
  'discussed', // unusually many comments per view
  'reaching', // travelled far past its own channel
  'classic', // old and still being found
  'none',
]);
export type PlaylistStatus = z.infer<typeof PlaylistStatus>;

/**
 * What the thing is, as opposed to how good it is.
 *
 * One word, so the row can wear it beside the rating without the two competing.
 * The order below is the order they are tried, and it is a claim about which
 * fact a reader needs first: that this is not a course to work through beats
 * everything, then that these are seminars rather than lectures, then that the
 * course is a whole one, and last that its lectures are not one length —
 * ninety minutes next to eight is a different thing to sit down to, and it is
 * the one case where a reader who checked the running time would be misled.
 * `lectures` is what is left over — two thirds of a lecture catalogue — and is
 * never shown, because a badge everyone wears separates nobody.
 */
export const PlaylistType = z.enum(['collection', 'seminars', 'course', 'uneven', 'lectures']);
export type PlaylistType = z.infer<typeof PlaylistType>;

/** The three normalised signals behind the rating, for the tooltip. */
export const SignalsSchema = z.object({
  approval: z.number().nullable(), // likes per view, vs peers and channel
  retention: z.number().nullable(), // last quarter over first, vs catalogue
  discussion: z.number().nullable(), // comments per view, vs peers
  reach: z.number().nullable(), // views per lecture per subscriber
});
export type Signals = z.infer<typeof SignalsSchema>;

export const BuiltPlaylistSchema = PlaylistSchema.extend({
  lectureLength: LectureLength,
  engagement: z.number(),
  /** Combined z-score of the signals below. The default sort, never shown raw. */
  rating: z.number(),
  status: PlaylistStatus,
  signals: SignalsSchema,
  /** Views of the last quarter over the first. Absent under 8 videos with views. */
  retention: z.number().optional(),
  curve: CurveKind.optional(),
  /**
   * [game:audience] The same fact as `retention`, read per lecture rather than
   * over the whole: the share of the opening lectures' views that survives to
   * each one, 0..100 and one entry per video in `videos`.
   *
   * It only ever falls, because "could have got this far" is not a quantity
   * that grows — see `audienceCurve` in `08-build.ts` for the running minimum
   * and for why the head is a median of the first few rather than the first
   * video alone. Written only where `curve` is `series`, the same gate
   * `measuredRetention` applies: on a shelf entered from search the number
   * computes and describes arrival rather than staying.
   *
   * Costs about one byte per lecture in the shard. Absent is the normal case
   * and every reader of it treats absence as "no answer", never as zero.
   */
  audience: z.array(z.number()).optional(),
  /**
   * A shelf of videos rather than a course — the `collection` type.
   *
   * Not the same question as `curve`, and deliberately kept apart from it.
   * `curve` is about the statistics — whether retention may be scored at all —
   * and is read off the views. This is about how the playlist was made, and is
   * read off the lecture titles, upload dates and lengths. A famous course
   * whose lectures are each found from search has an `assorted` curve and is
   * not a shelf.
   */
  collection: z.boolean().default(false),
  /**
   * A whole term of ordered lectures in equal slots — the counterpart of
   * `collection`, and the `course` type. Also structural, also silent about
   * quality.
   */
  fullCourse: z.boolean().default(false),
  /**
   * Share of the lectures whose length is nothing like the rest — more than two
   * and a half times the median, either way. Absent under eight lectures.
   */
  oddLengths: z.number().optional(),
  /** Last upload, which is what decides whether a playlist is still settling. */
  lastVideoAt: z.string().optional(),
  /** Lecture list, shipped with the shard so the modal needs no API call. */
  videos: z.array(VideoSchema).default([]),
  /** Set only when this recording is one part of a run. See `SeriesSchema`. */
  series: SeriesSchema.optional(),
});
export type BuiltPlaylist = z.infer<typeof BuiltPlaylistSchema>;

/* ─────────────────────────────  Overrides  ─────────────────────────── */

/** Hand edits applied on top of the automatic pipeline. Committed to git. */
export const OverridesSchema = z.object({
  /**
   * playlistId → courseId, or `null` to say "this is not a course".
   *
   * A list where one recording teaches several of our courses at once. The
   * first entry is the one it is filed under; the rest get the same recording
   * in their shard. See `Playlist.alsoCourses`.
   */
  matches: z
    .record(z.string(), z.union([z.string(), z.array(z.string()).min(1), z.null()]))
    .default({}),
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
  /**
   * The course's other names, as written rather than normalised.
   *
   * `k` is what a query is matched against and is unreadable by design —
   * inflected forms, single words, bait. These are the same names the card
   * prints, kept apart so the dropdown can say *why* a row is in it: someone
   * who typed «ТФКП» and got «Комплексный анализ» is owed the connection.
   */
  a: z.array(z.string()).optional(),
});
export type SearchEntry = z.infer<typeof SearchEntrySchema>;

/* ──────────────────────────────  Meta  ─────────────────────────────── */

export const MetaSchema = z.object({
  version: z.string(),
  builtAt: z.string(),
  /** The whole catalogue, hidden courses included — the coverage denominator. */
  courses: z.number(),
  /** Of those, how many are kept but not shown. See `BuiltCourseSchema.hidden`. */
  hidden: z.number(),
  domains: z.number(),
  playlists: z.number(),
  providers: z.number(),
  /** Share of courses that have at least one live playlist. 0..1 */
  coverage: z.number(),
  maxLevel: z.number(),
  /**
   * What each status cost in this build. Written out so that "why is this one
   * merely good" is answerable from the published data alone.
   */
  statusThresholds: z.record(z.string(), z.number()).optional(),
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
 *
 * And not far short of it either. This is read twice over — once as a tick, and
 * once as the offer to move on that appears under the picture — so a threshold
 * with a quarter of an hour of a long lecture still behind it would be calling
 * a lecture finished while there is teaching left in it.
 */
export const VIDEO_DONE_FRACTION = 0.95;

/**
 * A day of study, and what it was worth.
 *
 * The profile is a set of marks — this lecture is behind you, that course is
 * finished — and a mark says nothing about *when*. Every `at` in it is a last
 * time: study the same playlist for ten days running and it records one date.
 * So the days are logged as they happen, and since a log is being kept anyway,
 * it keeps the two numbers that make "this week" answerable at all.
 *
 * `sec` is time the reader actually spent: what the embedded player reported
 * playing, plus the length of anything ticked off by hand — see `credit()` in
 * the store, which is the only thing that writes here.
 */
export const DayLogSchema = z.object({
  /** Local `YYYY-MM-DD` — the day it felt like, not the UTC one. */
  day: z.string(),
  /** Seconds of study credited to it. */
  sec: z.number().default(0),
  /** Lectures finished on it. */
  lectures: z.number().default(0),
});
export type DayLog = z.infer<typeof DayLogSchema>;

/**
 * The shape this build writes. Anything higher was written by a newer site.
 *
 * Declared above `ProfileSchema` because the schema reads it, and a `const` is
 * in its temporal dead zone until the line that declares it runs — below the
 * schema this is a `ReferenceError` at import, which is the module failing to
 * load at all rather than a bug anybody gets to debug.
 */
export const PROFILE_VERSION = 4;

export const ProfileSchema = z.object({
  /*
   * The literal and `PROFILE_VERSION` are one number written twice, and they
   * were once written twice with two different values: bumping the constant
   * alone made `migrateProfile` produce a profile its own schema rejects, and
   * a rejected profile is read as corrupt and **replaced by an empty one**.
   * Every stored profile in existence would have been wiped by the update that
   * was meant to carry its goal across. So the schema takes the constant.
   */
  version: z.literal(PROFILE_VERSION),
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
  /**
   * The days something was studied, oldest first — see `DayLogSchema`.
   *
   * A log rather than a counter, because the questions people ask are "how many
   * days in a row" and "how much this week", and a counter can answer neither
   * after the fact.
   */
  days: z.array(DayLogSchema).default([]),
  settings: z
    .object({
      // `catch` rather than `default`: a profile carrying a language this build
      // no longer ships would otherwise fail the whole parse and be read as
      // corrupt, losing every mark in it over one string.
      lang: UiLang.catch('ru'),
      /**
       * Which languages the playlist filter asks for, or `null` for "never
       * said".
       *
       * The two are different answers and the difference is the whole point of
       * the field. Unanswered means the filter starts on the language of the
       * page, which is the right guess for somebody reading the Russian site
       * and the right guess again for somebody reading the English one.
       * Answered means it starts where they put it — **including an empty
       * list**, which is somebody saying "show me everything, I do not care
       * what it is in", and which no `[]`-means-default scheme can tell from
       * silence.
       *
       * Stored rather than kept for the session because the alternative was
       * the filter quietly reappearing on the next course opened, which is the
       * one thing a filter must not do: it makes a reader who cleared it
       * believe they are seeing everything.
       *
       * `catch` like every other field here, so a value written by a build that
       * offered a third language cannot fail the parse and cost the reader
       * their progress over a string.
       */
      playlistLangs: z.array(z.string()).nullable().catch(null),
      theme: z.enum(['auto', 'light', 'dark']).default('auto'),
      splitRatio: z.number().min(0.3).max(0.8).default(0.62),
      /**
       * Hide everything past this stage. A setting rather than a URL parameter:
       * it says something about the reader, not about the view being shared, so
       * it should hold across domains and across sessions.
       */
      maxStage: Stage.nullable().default(null),
      /**
       * Draw every edge of the selected course's chain, rather than cutting it
       * back to a tree rooted at that course.
       *
       * Off by default, and the default is the lossy one on purpose. `deps` is
       * already a transitive reduction — the build warns on any edge the graph
       * implies — so nothing here is redundant, and the sixth of the edges a
       * tree drops are the second prerequisites of the courses that have more
       * than one. What buys that back is the panel: «Опирается на» names every
       * direct prerequisite whatever the columns are drawing, so the fact is
       * never actually hidden, only the line is. A tree of three or four
       * unbroken curves is what most people come to this screen to read; the
       * whole graph is a question asked on top of it, and asking is a click.
       */
      fullGraph: z.boolean().catch(false),
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
      /**
       * The speed the player opens at.
       *
       * A setting rather than a per-lecture choice: somebody who watches
       * lectures at 1.5× watches every lecture at 1.5×, and re-picking it on
       * each of thirty videos is the kind of small tax that makes a control not
       * worth having. Held loosely — the range is the player's, and the player
       * rounds anything outside its own list down to 2× without complaining.
       */
      playbackRate: z.number().min(0.25).max(4).catch(1),
      /**
       * Minutes of study to aim for on a day of study, or null for no goal.
       *
       * A setting rather than a number derived from anything: how much somebody
       * means to study is the one fact about their week the site cannot work
       * out for itself. Time rather than lectures, or a goal would be met by
       * six ten-minute explainers.
       *
       * The **day** is what is stored, and it used to be the week. A week is
       * the unit somebody plans in and the day is the unit they act in, and
       * only the second one can rate a day: a strip of squares shaded against
       * a weekly figure is shaded against nothing. The week is still asked and
       * still shown — it is this times `goalDays`, which is exact, where the
       * division the other way round lands on «43 минуты» and reads as a
       * target nobody set.
       *
       * Null is the default and stays the default. A goal nobody asked for is a
       * debt handed to somebody who came here to watch a lecture, and the whole
       * point of it is that it was chosen.
       */
      dayGoal: z.number().min(0).nullable().catch(null),
      /**
       * Days of the week that goal is meant for. Half of one setting: nobody
       * studies seven days in seven, and a week counted as seven days of the
       * day's goal is a bar that cannot be filled by anybody keeping to it.
       */
      goalDays: z.number().int().min(1).max(7).catch(5),
      /**
       * Whether this browser is counted in the site's own statistics.
       *
       * On by default and stated plainly in the settings, which is the trade
       * this site can honestly offer: nothing about a reader is collected —
       * no account, no identifier of ours, no advertising signals — and what
       * is counted is what the catalogue itself needs to know, chiefly which
       * courses are opened and which searches find nothing. The last of those
       * is the one that pays for the switch being here rather than absent:
       * a search that returns nothing is a course the catalogue is missing,
       * and there is no other way for the site to hear about it.
       *
       * `catch` like the rest, so a value this build does not understand
       * cannot fail the parse and cost somebody every mark in their profile.
       * What the switch actually does is in `src/lib/analytics.ts`.
       */
      analytics: z.boolean().catch(true),
      /**
       * The pomodoro, in the four numbers it is cut by: how long a session
       * runs, how long the gap between two is, how many sessions stand before
       * the long rest, and how long that one is.
       *
       * Four flat fields rather than one object, like `dayGoal`/`goalDays`
       * above and for the same reason: every one of them is `catch`-guarded on
       * its own, so a profile written before this existed — or one carrying a
       * number a later build stops offering — loses that one setting and not
       * the three beside it. A nested object fails as a whole.
       *
       * They are stored because a reader who has decided that a session is
       * fifty minutes has decided it for the term, and re-choosing it at the
       * top of every evening is the tax that makes a control not worth having.
       * Nothing here starts a timer: the numbers wait until somebody presses
       * play on one, which is the difference between a setting and a target —
       * see `src/lib/pomodoro.ts`.
       */
      pomodoroFocus: z.number().int().min(5).max(180).catch(25),
      pomodoroBreak: z.number().int().min(1).max(60).catch(5),
      pomodoroEvery: z.number().int().min(1).max(12).catch(4),
      pomodoroLong: z.number().int().min(1).max(120).catch(20),
    })
    .default({
      lang: 'ru',
      theme: 'auto',
      splitRatio: 0.62,
      maxStage: null,
      panelLinks: 'closed',
      resume: true,
      dayGoal: null,
      goalDays: 5,
      analytics: true,
    }),
});
export type Profile = z.infer<typeof ProfileSchema>;
export type RecentEntry = Profile['recent'][number];
export type VideoMark = Profile['videos'][string];

/** Long enough to cover "what was that lecture last month", short enough to stay in localStorage. */
export const RECENT_LIMIT = 60;

/** Two years of study days is a few tens of kilobytes, and nobody counts a streak longer. */
export const DAYS_LIMIT = 730;

/**
 * The storage slot. Still says `v1` because it names the slot rather than the
 * shape in it — `version` inside does that — and renaming it would strand every
 * profile already written.
 */
export const PROFILE_KEY = 'catalog.profile.v1';

/**
 * A stored profile brought up to the current shape.
 *
 * Each step is a separate `if`, so a profile arriving from any version walks
 * through all of them in order rather than needing a path of its own. Returned
 * as unknown rather than parsed here, so the caller keeps one parse and one
 * place that decides what a failed parse means.
 *
 * Nothing is ever lost in a step: a version 1 profile knew nothing of lectures
 * but its ticks mean exactly what they still mean, and a version 2 one had days
 * of study with nothing counted against them. What cannot be recovered is time
 * spent before the log existed, so those days start at zero — the streak they
 * carry is the part that was actually recorded.
 */
export function migrateProfile(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const version = (raw as { version?: unknown }).version;
  if (typeof version !== 'number' || version >= PROFILE_VERSION) return raw;

  const next: Record<string, unknown> = {
    ...(raw as Record<string, unknown>),
    version: PROFILE_VERSION,
  };

  // Every status in a version 1 profile was pressed by hand — there was no
  // other way to set one — so they all carry the flag that keeps the new
  // automation from re-deciding them.
  if (version < 2) {
    const courses = (next.courses ?? {}) as Record<string, object>;
    next.courses = Object.fromEntries(
      Object.entries(courses).map(([id, entry]) => [id, { ...entry, manual: true }])
    );
  }

  // Version 2 logged the bare day. It becomes a day worth nothing measured,
  // which is the truth about it rather than a guess.
  if (version < 3) {
    const days: unknown[] = Array.isArray(next.days) ? next.days : [];
    next.days = days.map((day) => (typeof day === 'string' ? { day, sec: 0, lectures: 0 } : day));
  }

  /*
   * Version 3 aimed at a week; version 4 aims at a day, so many days a week.
   *
   * The week that was chosen is preserved rather than reinterpreted — see
   * `goalPairFor`, which picks the pair of offered steps whose product is
   * nearest to it, and lands exactly on every one of the six weeks that could
   * be chosen. Somebody who set five hours a week gets an hour a day, five
   * days a week, and their bar reads the same on the morning after the update
   * as it did the night before, which is the whole bar for a migration of a
   * setting.
   */
  if (version < 4) {
    const settings = (next.settings ?? {}) as Record<string, unknown>;
    const weekGoal = settings.weekGoal;
    const { weekGoal: _dropped, ...rest } = settings;
    next.settings =
      typeof weekGoal === 'number' && weekGoal > 0
        ? { ...rest, ...goalPairFor(weekGoal) }
        : { ...rest, dayGoal: null, goalDays: 5 };
  }

  return next;
}

/** Minutes a day the goal control offers. */
export const DAY_GOALS = [15, 30, 45, 60, 90, 120] as const;
/** And days a week. Two is a habit; one is a lecture with a date on it. */
export const GOAL_DAYS = [2, 3, 4, 5, 6, 7] as const;

/**
 * The four ladders the pomodoro is set on.
 *
 * Ladders rather than free numbers, for the reason the day's goal is one: the
 * decision is «about half an hour», not «twenty-seven minutes», and a field
 * that accepts any integer asks for a precision nobody has. They widen as they
 * go, like a volume knob.
 *
 * The lengths are the classic ones stretched a little upwards, because a
 * lecture is not a task list: the recording in the frame runs 42 minutes at the
 * median, and a session that has to be interrupted in the middle of one is a
 * timer fighting the thing it is timing. Twenty-five stays the default all the
 * same — it is what somebody who says «помодоро» means, and the ladder is one
 * press wide.
 */
export const POMODORO_FOCUS = [15, 25, 30, 45, 60] as const;
export const POMODORO_BREAK = [3, 5, 10, 15] as const;
/** Sessions before the long rest. One would make every break the long one. */
export const POMODORO_EVERY = [2, 3, 4, 5] as const;
export const POMODORO_LONG = [10, 15, 20, 30] as const;

/**
 * The offered pair whose week comes nearest to a week somebody already chose.
 *
 * Thirty-six pairs, so it is a search rather than arithmetic — and the search
 * is what makes it exact: every one of the old ladder's six weeks (1, 2, 3, 5,
 * 7, 10 hours) is a product of two offered steps, and rounding the division
 * instead would have turned an hour a week into fifteen minutes over four days
 * *or* five, one of which is not an hour.
 *
 * Ties go to the pair with the most days: the same week spread wider is the
 * one more likely to be kept, and it is the reading that makes «дней закрыто»
 * worth counting.
 */
export function goalPairFor(weekHours: number): { dayGoal: number; goalDays: number } {
  let best = { dayGoal: 60, goalDays: 5 };
  let closest = Infinity;
  for (const days of GOAL_DAYS) {
    for (const minutes of DAY_GOALS) {
      const distance = Math.abs((minutes * days) / 60 - weekHours);
      // `<=`, with days walked from fewest to most, is what makes the tie go
      // to the wider spread.
      if (distance <= closest + 1e-9) {
        closest = distance;
        best = { dayGoal: minutes, goalDays: days };
      }
    }
  }
  return best;
}

/* ────────────────────────────  Constants  ──────────────────────────── */

// The rating's own knobs live beside the formula in `scripts/lib/score.ts`:
// nothing on the client needs them, and a copy here would drift from the one
// place they are actually applied.

/**
 * Lecture length buckets, in seconds.
 *
 * `short` is not a finer slice of `lesson` but a different kind of recording:
 * 1055 playlists in the catalogue have a median lecture under a quarter of an
 * hour — Khan Academy, Neso Academy, Michel van Biezen — and calling an eight
 * minute explainer «урок», as the old four buckets did, told the reader the
 * one thing about it that is not true.
 */
export const LECTURE_BUCKETS: Array<{ id: LectureLength; maxSeconds: number }> = [
  { id: 'short', maxSeconds: 15 * 60 },
  { id: 'lesson', maxSeconds: 40 * 60 },
  { id: 'pair', maxSeconds: 100 * 60 },
  { id: 'double', maxSeconds: 200 * 60 },
  { id: 'long', maxSeconds: Infinity },
];

export function lectureLengthOf(medianSeconds: number): LectureLength {
  return LECTURE_BUCKETS.find((b) => medianSeconds <= b.maxSeconds)!.id;
}

/**
 * Which of the four things a playlist is — see `PlaylistType`.
 *
 * Read off fields the build has already worked out, rather than stored: all
 * three inputs ship with the shard, and a fifth derived field would be one more
 * thing to keep in step with them.
 */
export function playlistTypeOf(playlist: {
  collection?: boolean;
  fullCourse?: boolean;
  oddLengths?: number;
  kind: PlaylistKind;
}): PlaylistType {
  if (playlist.collection) return 'collection';
  if (playlist.kind === 'seminars') return 'seminars';
  if (playlist.fullCourse) return 'course';
  if ((playlist.oddLengths ?? 0) >= UNEVEN_SHARE) return 'uneven';
  return 'lectures';
}

/**
 * How many lectures have to be the odd ones out before the row says so.
 *
 * One in ten. Deliberately a count and not a spread: the scatter of the lengths
 * around their median is a robust statistic and throws away exactly the videos
 * this is about — Станкевич's discrete maths runs fourteen lectures of about
 * eighty-five minutes with an eight-minute one and a ten-minute one among them,
 * and its MAD is 0.15, which reads as «even». Two lectures in fourteen are not.
 */
export const UNEVEN_SHARE = 0.1;

/**
 * The share of the audience still there at the end — when that is a fact.
 *
 * Two ways for it not to be, and the second is the one worth naming. A playlist
 * under eight videos with views has no curve to read at all. And a playlist
 * with an `assorted` curve — a channel's «Astronomy», entered from search at a
 * random point — has a ratio that can be computed and means nothing: the last
 * quarter is not what people reached, it is what the search sent them to. The
 * rating engine already refuses to score it (`docs/rating.md`), so nothing that
 * shows the number or ranks on it may do otherwise. 540 playlists of 2902 hang
 * on this test, and without it they take the top of the retention sort.
 */
export function measuredRetention(playlist: {
  retention?: number;
  curve?: CurveKind;
}): number | null {
  if (playlist.retention === undefined || playlist.curve === 'assorted') return null;
  return playlist.retention;
}
