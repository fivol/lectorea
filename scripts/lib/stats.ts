import fs from 'node:fs';
import path from 'node:path';
import {
  OverridesSchema,
  STAGE_ORDER,
  type BuiltCourse,
  type BuiltDomain,
  type BuiltPlaylist,
  type BuiltProvider,
  type Meta,
  type PlaylistStatus,
} from '../../shared/schema.js';
import { forwardClosureSizes, dependantsIndex } from '../../shared/graph.js';
import { median } from './score.js';
import { dailyQuota, paths } from './config.js';
import { dbExists, MATCH_THRESHOLD, openDb, type Db } from './db.js';
import { REFRESH_DAYS } from './tasks.js';
import { loadYamlObject } from './sources.js';

/**
 * Everything the dashboard shows, computed once into plain data.
 *
 * Three sources answer three different questions, and the split is deliberate:
 * `public/data` says what the site actually publishes, `data/cache.db` says
 * what the crawl knows but has not published, and `data/` says what was decided
 * by hand. A number is only ever read from the layer that owns it, so the page
 * never has to explain why two counts of "playlists" disagree.
 *
 * Both the catalogue and the cache may be missing — one is generated, the other
 * is not committed — so every section is nullable and the page says which.
 */

/* ────────────────────────────  Shared shapes  ──────────────────────────── */

/** Which meaning a mark carries. Identity hues for the continents, status for the rest. */
export type Tone =
  | 'series'
  | 'accent'
  | 'warning'
  | 'danger'
  | 'muted'
  | 'formal'
  | 'social'
  | 'humanities';

export type Bar = { label: string; value: number; note?: string; tone?: Tone };
export type Point = { label: string; value: number };
export type Fact = { label: string; value: string; hint?: string };

export type DomainCoverage = {
  id: string;
  title: string;
  continent: string;
  courses: number;
  covered: number;
  playlists: number;
  hours: number;
};

export type Gap = {
  id: string;
  title: string;
  domain: string;
  level: number;
  stage: string;
  blocks: number;
};

export type Hub = {
  id: string;
  title: string;
  direct: number;
  behind: number;
  playlists: number;
};

export type JobRow = { type: string; done: number; pending: number; error: number; other: number };

/**
 * What is left to do, and what it costs.
 *
 * The two currencies are different and must not be added up: quota is spent by
 * the day and refills by itself, review time is spent by a person and does not.
 * Most of the queue turns out to be the second kind, which is only visible if
 * the estimate keeps them apart.
 */
export type Forecast = {
  /** Where the worker stops for the day, from `YOUTUBE_QUOTA_CEILING`. */
  ceiling: number;
  /** Crawl jobs that can still put something in the catalogue. */
  useful: { playlists: number; units: number; days: number };
  /** Queued jobs on playlists already ruled out — quota that would buy nothing. */
  wasted: { playlists: number; units: number };
  /** The whole queue, useful and not: what finishing the current channels costs. */
  total: { playlists: number; units: number; days: number; videos: number };
  /** Passes that are scheduled rather than queued, and the date they come round. */
  scheduled: Array<{ label: string; due: number; when: string | null }>;
  review: { playlists: number; courses: number; hours: number };
  /** Empty courses the review queue alone could close. */
  fillable: { courses: number; candidates: number };
  /** Empty courses with nothing in the cache at all — they need new sources. */
  unsourced: number;
  projectedCoverage: number;
  facts: Fact[];
};

export type CatalogStats = {
  meta: Meta;
  ageHours: number;
  hero: { covered: number; total: number; share: number };
  /** Not rendered directly — the forecast asks what the review queue could close. */
  emptyCourses: string[];
  tiles: Fact[];
  coverage: {
    byBucket: Bar[];
    byDomain: DomainCoverage[];
    byContinent: Bar[];
    byStage: Bar[];
    gaps: Gap[];
  };
  graph: {
    facts: Fact[];
    byLevel: Point[];
    byStage: Bar[];
    byDomain: Bar[];
    hubs: Hub[];
    longestChain: string[];
  };
  playlists: {
    facts: Fact[];
    byLang: Bar[];
    byKind: Bar[];
    byCompleteness: Bar[];
    byLength: Bar[];
    byScore: Point[];
    byStatus: Bar[];
    byYear: Point[];
    topProviders: Bar[];
    topLecturers: Bar[];
    byProviderType: Bar[];
  };
};

export type CrawlStats = {
  dbSizeMb: number;
  forecast: Forecast;
  facts: Fact[];
  funnel: Bar[];
  quotaByDay: Point[];
  matchesByDay: Point[];
  matchesCumulative: Point[];
  checksByDay: Point[];
  videosByYear: Point[];
  freshness: Bar[];
  jobs: JobRow[];
  matchMethods: Bar[];
  confidence: Point[];
  queue: Bar[];
  topChannels: Bar[];
};

export type CurationStats = {
  facts: Fact[];
  overrides: Bar[];
};

export type Stats = {
  generatedAt: string;
  notes: string[];
  catalog: CatalogStats | null;
  crawl: CrawlStats | null;
  curation: CurationStats;
};

/* ─────────────────────────────────  Helpers  ───────────────────────────── */

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function countBy<T>(items: T[], key: (item: T) => string | null | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = key(item);
    if (value === null || value === undefined || value === '') continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function topBars(counts: Map<string, number>, limit: number, rest = 'остальные'): Bar[] {
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const head: Bar[] = sorted.slice(0, limit).map(([label, value]) => ({ label, value }));
  const tail = sorted.slice(limit);
  if (tail.length) {
    head.push({
      label: rest,
      value: tail.reduce((sum, [, value]) => sum + value, 0),
      note: `${tail.length}`,
      tone: 'muted',
    });
  }
  return head;
}

/** A window of days ending today, gaps filled with zero. */
function dailyWindow(byDay: Map<string, number>, days: number): Point[] {
  const today = new Date();
  const points: Point[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const day = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back)
    );
    const key = day.toISOString().slice(0, 10);
    points.push({ label: key, value: byDay.get(key) ?? 0 });
  }
  return points;
}

/**
 * How many days the daily charts should cover.
 *
 * A fixed window would be wrong at both ends of the project's life: on a
 * database one day old, eighty-nine empty columns say nothing, and on a
 * year-old one a fixed fortnight hides the shape. So it follows the data —
 * from the first day anything happened until today — with a floor that keeps a
 * fresh database from drawing a chart two columns wide, and a ceiling that
 * keeps the columns from turning into hairlines. Every daily chart is given the
 * same window, which is what makes them readable side by side.
 */
function windowDays(earliest: string | null, min = 14, max = 90): number {
  if (!earliest) return min;
  const days = Math.ceil((Date.now() - Date.parse(`${earliest}T00:00:00Z`)) / (24 * HOUR * 1000));
  return Math.min(max, Math.max(min, days + 1));
}

function running(points: Point[], from: number): Point[] {
  let total = from;
  return points.map((point) => {
    total += point.value;
    return { label: point.label, value: total };
  });
}

const HOUR = 3600;

function hoursOf(seconds: number): number {
  return Math.round(seconds / HOUR);
}

/* ──────────────────────────────  Catalogue  ────────────────────────────── */

type CoursesFile = { maxLevel: number; courses: BuiltCourse[] };

const STAGE_TITLES: Record<string, string> = {
  'school-8': '8 класс',
  'school-9': '9 класс',
  'school-10': '10 класс',
  'school-11': '11 класс',
  'bachelor-1': '1 курс',
  'bachelor-2': '2 курс',
  'bachelor-3': '3 курс',
  'bachelor-4': '4 курс',
  'master-1': 'магистратура 1',
  'master-2': 'магистратура 2',
  phd: 'аспирантура',
};

const CONTINENT_TITLES: Record<string, string> = {
  formal: 'Точные и естественные',
  social: 'Социальные',
  humanities: 'Гуманитарные',
};

const CONTINENT_TONES: Record<string, Tone> = {
  formal: 'formal',
  social: 'social',
  humanities: 'humanities',
};

const KIND_TITLES: Record<string, string> = {
  lectures: 'лекции',
  seminars: 'семинары',
  mixed: 'смешанные',
  unknown: 'не определено',
};

const COMPLETENESS_TITLES: Record<string, string> = {
  full: 'полный курс',
  partial: 'фрагмент',
  unknown: 'не определено',
};

const LENGTH_TITLES: Record<string, string> = {
  short: 'короткие, до 15 мин',
  lesson: 'урок, до 40 мин',
  pair: 'пара, до 100 мин',
  double: 'двойная, до 200 мин',
  long: 'длиннее 200 мин',
};

/**
 * In the order the badge is chosen, so the chart reads as the decision itself:
 * everything above a row has already been taken out of it.
 */
const STATUS_TITLES: Array<[PlaylistStatus, string]> = [
  ['sparse', 'мало данных'],
  ['fresh', 'новый'],
  ['excellent', 'отличный'],
  ['classic', 'классика'],
  ['retained', 'досматривают'],
  ['liked', 'нравится'],
  ['discussed', 'обсуждают'],
  ['reaching', 'ушёл в народ'],
  ['none', 'без статуса'],
];

/** Playlists per course, in buckets — the shape of the coverage, not its average. */
const COVERAGE_BUCKETS: Array<{ label: string; max: number; tone: Tone }> = [
  { label: 'ни одного', max: 0, tone: 'danger' },
  { label: '1', max: 1, tone: 'warning' },
  { label: '2–3', max: 3, tone: 'series' },
  { label: '4–7', max: 7, tone: 'series' },
  { label: '8–15', max: 15, tone: 'series' },
  { label: '16+', max: Infinity, tone: 'accent' },
];

function collectCatalog(notes: string[]): CatalogStats | null {
  const meta = readJson<Meta>(path.join(paths.outData, 'meta.json'));
  const coursesFile = readJson<CoursesFile>(path.join(paths.outData, 'courses.json'));
  const domains = readJson<BuiltDomain[]>(path.join(paths.outData, 'domains.json'));
  const providers = readJson<Record<string, BuiltProvider>>(
    path.join(paths.outData, 'providers.json')
  );
  if (!meta || !coursesFile || !domains || !providers) {
    notes.push('public/data не собран — запустите `pnpm data:build`');
    return null;
  }

  const dict =
    readJson<Record<string, string>>(path.join(paths.outData, 'i18n', 'ru.json')) ?? {};
  const titleOf = (kind: string, id: string): string => dict[`${kind}.${id}.title`] ?? id;

  const courses = coursesFile.courses;
  const playlists = readShards();

  /* Coverage ------------------------------------------------------------- */

  const covered = courses.filter((course) => course.playlistCount > 0);

  const bucketCounts = COVERAGE_BUCKETS.map((bucket, index) => {
    const min = index === 0 ? 0 : COVERAGE_BUCKETS[index - 1].max + 1;
    return {
      label: bucket.label,
      tone: bucket.tone,
      value: courses.filter(
        (course) => course.playlistCount >= min && course.playlistCount <= bucket.max
      ).length,
    };
  });

  const byDomain: DomainCoverage[] = domains
    .map((domain) => {
      const own = courses.filter((course) => course.domains.includes(domain.id));
      return {
        id: domain.id,
        title: titleOf('domain', domain.id),
        continent: domain.continent,
        courses: own.length,
        covered: own.filter((course) => course.playlistCount > 0).length,
        playlists: domain.playlistCount,
        hours: domain.hours,
      };
    })
    .sort((a, b) => b.courses - a.courses || a.title.localeCompare(b.title, 'ru'));

  const byContinent: Bar[] = Object.keys(CONTINENT_TITLES).map((continent) => {
    const ids = new Set(domains.filter((d) => d.continent === continent).map((d) => d.id));
    const own = courses.filter((course) => course.domains.some((id) => ids.has(id)));
    const withMaterial = own.filter((course) => course.playlistCount > 0).length;
    return {
      label: CONTINENT_TITLES[continent],
      value: own.length ? Math.round((withMaterial / own.length) * 100) : 0,
      note: `${withMaterial} из ${own.length}`,
      tone: CONTINENT_TONES[continent],
    };
  });

  const byStageCoverage: Bar[] = STAGE_ORDER.flatMap((stage): Bar[] => {
    const own = courses.filter((course) => course.stage === stage);
    if (!own.length) return [];
    const withMaterial = own.filter((course) => course.playlistCount > 0).length;
    return [
      {
        label: STAGE_TITLES[stage] ?? stage,
        value: Math.round((withMaterial / own.length) * 100),
        note: `${withMaterial} из ${own.length}`,
        tone: 'accent',
      },
    ];
  });

  /* Graph ---------------------------------------------------------------- */

  // courses.json is written in topological order, which is exactly what the
  // forward closure needs — no second sort.
  const order = courses.map((course) => course.id);
  const behind = forwardClosureSizes(courses, order);
  const dependants = dependantsIndex(courses);
  const byId = new Map(courses.map((course) => [course.id, course]));

  const gaps: Gap[] = courses
    .filter((course) => course.playlistCount === 0)
    .map((course) => ({
      id: course.id,
      title: titleOf('course', course.id),
      domain: titleOf('domain', course.domains[0]),
      level: course.level,
      stage: STAGE_TITLES[course.stage] ?? course.stage,
      blocks: behind.get(course.id) ?? 0,
    }))
    .sort((a, b) => b.blocks - a.blocks || a.level - b.level)
    .slice(0, 12);

  const hubs: Hub[] = courses
    .map((course) => ({
      id: course.id,
      title: titleOf('course', course.id),
      direct: (dependants.get(course.id) ?? []).length,
      behind: behind.get(course.id) ?? 0,
      playlists: course.playlistCount,
    }))
    .sort((a, b) => b.behind - a.behind || b.direct - a.direct)
    .slice(0, 12);

  const depsTotal = courses.reduce((sum, course) => sum + course.deps.length, 0);
  const softTotal = courses.reduce((sum, course) => sum + course.soft.length, 0);
  // `related` is symmetric and stored on both sides after the build, so the
  // number of links is half the number of entries.
  const relatedTotal = courses.reduce((sum, course) => sum + course.related.length, 0) / 2;
  const roots = courses.filter((course) => !course.deps.length);
  const leaves = courses.filter((course) => !(dependants.get(course.id) ?? []).length);
  const isolated = courses.filter(
    (course) => !course.deps.length && !(dependants.get(course.id) ?? []).length
  );

  const byLevel: Point[] = Array.from({ length: coursesFile.maxLevel + 1 }, (_, level) => ({
    label: String(level),
    value: courses.filter((course) => course.level === level).length,
  }));

  const graphFacts: Fact[] = [
    { label: 'Связей deps', value: fmt(depsTotal), hint: 'жёстких рёбер в графе' },
    { label: 'Мягких связей', value: fmt(softTotal), hint: 'soft — желательно, но не обязательно' },
    { label: 'Смежных курсов', value: fmt(relatedTotal), hint: 'related, пар' },
    {
      label: 'В среднем зависимостей',
      value: courses.length ? (depsTotal / courses.length).toFixed(1) : '0',
      hint: 'на курс',
    },
    { label: 'Без предпосылок', value: fmt(roots.length), hint: 'колонка 0 — с чего начинают' },
    { label: 'Ничего не открывают', value: fmt(leaves.length), hint: 'листья графа' },
    {
      label: 'Изолированных',
      value: fmt(isolated.length),
      hint: 'ни зависимостей, ни зависимых — кандидаты на разметку',
    },
    {
      label: 'Самая длинная цепочка',
      value: `${coursesFile.maxLevel + 1}`,
      hint: 'курсов подряд',
    },
  ];

  const longestChain = buildLongestChain(courses, byId).map((id) => titleOf('course', id));

  /* Playlists ------------------------------------------------------------ */

  const totalSeconds = playlists.reduce((sum, item) => sum + item.totalSeconds, 0);
  const lectures = playlists.reduce((sum, item) => sum + item.videoCount, 0);
  const views = playlists.reduce((sum, item) => sum + item.stats.views, 0);
  const withCaptions = playlists.filter((item) => item.captions.length).length;
  const dead = playlists.filter((item) => !item.alive).length;

  const playlistFacts: Fact[] = [
    { label: 'Плейлистов', value: fmt(playlists.length), hint: 'опубликовано в каталоге' },
    { label: 'Лекций', value: fmt(lectures), hint: 'видео суммарно' },
    { label: 'Часов', value: fmt(hoursOf(totalSeconds)), hint: 'общая длительность' },
    {
      label: 'Медиана лекции',
      value: playlists.length
        ? `${Math.round(median(playlists.map((item) => item.medianSeconds)) / 60)} мин`
        : '—',
    },
    {
      label: 'Медиана курса',
      value: playlists.length
        ? `${(median(playlists.map((item) => item.totalSeconds)) / HOUR)
            .toFixed(1)
            .replace('.', ',')} ч`
        : '—',
    },
    {
      label: 'Просмотров',
      value: compact(views),
      hint: `${fmt(views)} суммарно у всех плейлистов`,
    },
    {
      label: 'С субтитрами',
      value: playlists.length ? `${Math.round((withCaptions / playlists.length) * 100)}%` : '—',
      hint: `${fmt(withCaptions)} из ${fmt(playlists.length)}`,
    },
    {
      label: 'Недоступных',
      value: fmt(dead),
      hint: 'помечены alive = false при последней проверке',
    },
  ];

  // The rating is a z-score around zero, so the bins are half a sigma wide and
  // the labels say so. A histogram of it is the fastest way to see a build that
  // has quietly collapsed everything onto one value.
  const byScore: Point[] = Array.from({ length: 12 }, (_, bin) => {
    const low = -3 + bin * 0.5;
    return {
      label: low.toFixed(1),
      value: playlists.filter((item) => {
        const bucket = Math.min(11, Math.max(0, Math.floor((item.rating + 3) / 0.5)));
        return bucket === bin;
      }).length,
    };
  });

  const byStatus: Bar[] = STATUS_TITLES.map(([id, label]) => ({
    label,
    value: playlists.filter((item) => item.status === id).length,
  })).filter((bar) => bar.value > 0);

  const years = playlists
    .map((item) => item.year)
    .filter((year): year is number => typeof year === 'number' && year >= 2006);
  const byYear: Point[] = years.length
    ? Array.from(
        { length: Math.max(...years) - Math.min(...years) + 1 },
        (_, index): Point => {
          const year = Math.min(...years) + index;
          return { label: String(year), value: years.filter((item) => item === year).length };
        }
      )
    : [];

  const providerCounts = new Map<string, number>();
  for (const item of playlists) {
    const title = providers[item.providerId]?.title ?? item.providerId;
    providerCounts.set(title, (providerCounts.get(title) ?? 0) + 1);
  }

  const providerTypes = new Map<string, number>();
  for (const item of playlists) {
    const type = providers[item.providerId]?.type ?? 'individual';
    providerTypes.set(type, (providerTypes.get(type) ?? 0) + 1);
  }
  const PROVIDER_TYPE_TITLES: Record<string, string> = {
    university: 'университеты',
    platform: 'платформы',
    individual: 'авторские каналы',
  };

  return {
    meta,
    ageHours: (Date.now() - Date.parse(meta.builtAt)) / (HOUR * 1000),
    hero: {
      covered: covered.length,
      total: courses.length,
      share: courses.length ? covered.length / courses.length : 0,
    },
    emptyCourses: courses
      .filter((course) => course.playlistCount === 0)
      .map((course) => course.id),
    tiles: [
      { label: 'Курсов', value: fmt(meta.courses) },
      { label: 'Областей', value: fmt(meta.domains) },
      { label: 'Плейлистов', value: fmt(meta.playlists) },
      { label: 'Провайдеров', value: fmt(meta.providers) },
      { label: 'Часов материала', value: fmt(hoursOf(totalSeconds)) },
      { label: 'Лекций', value: fmt(lectures) },
      { label: 'Колонок сложности', value: fmt(meta.maxLevel + 1) },
      { label: 'Курсов без материала', value: fmt(courses.length - covered.length) },
      {
        label: 'Скрыто с сайта',
        value: fmt(meta.hidden),
        hint: 'пустые курсы, от которых ничего не зависит: остаются в данных и вернутся с первым плейлистом',
      },
    ],
    coverage: {
      byBucket: bucketCounts,
      byDomain,
      byContinent,
      byStage: byStageCoverage,
      gaps,
    },
    graph: {
      facts: graphFacts,
      byLevel,
      byStage: STAGE_ORDER.map((stage) => ({
        label: STAGE_TITLES[stage] ?? stage,
        value: courses.filter((course) => course.stage === stage).length,
      })).filter((bar) => bar.value > 0),
      byDomain: topBars(
        countBy(
          courses.flatMap((course) => course.domains.slice(0, 1)),
          (id) => titleOf('domain', id)
        ),
        14,
        'прочие области'
      ),
      hubs,
      longestChain,
    },
    playlists: {
      facts: playlistFacts,
      byLang: topBars(countBy(playlists, (item) => item.lang.toUpperCase()), 6, 'другие языки'),
      byKind: [...countBy(playlists, (item) => KIND_TITLES[item.kind] ?? item.kind)].map(
        ([label, value]) => ({ label, value })
      ),
      byCompleteness: [
        ...countBy(playlists, (item) => COMPLETENESS_TITLES[item.completeness] ?? item.completeness),
      ].map(([label, value]) => ({ label, value })),
      byLength: Object.entries(LENGTH_TITLES).map(([id, label]) => ({
        label,
        value: playlists.filter((item) => item.lectureLength === id).length,
      })),
      byScore,
      byStatus,
      byYear,
      topProviders: topBars(providerCounts, 14, 'остальные провайдеры'),
      topLecturers: topBars(countBy(playlists, (item) => item.lecturer), 10, 'остальные'),
      byProviderType: [...providerTypes].map(([type, value]) => ({
        label: PROVIDER_TYPE_TITLES[type] ?? type,
        value,
      })),
    },
  };
}

function readShards(): BuiltPlaylist[] {
  if (!fs.existsSync(paths.outPlaylists)) return [];
  const playlists: BuiltPlaylist[] = [];
  for (const name of fs.readdirSync(paths.outPlaylists)) {
    if (!name.endsWith('.json')) continue;
    const shard = readJson<BuiltPlaylist[]>(path.join(paths.outPlaylists, name));
    if (shard) playlists.push(...shard);
  }
  return playlists;
}

/**
 * One chain of the maximum depth, as a reading order.
 *
 * Walks back from a deepest course through the dependency that carries the
 * depth. `minLevel` can lift a course above `max(deps) + 1`, so the step down
 * is "the deepest dependency" rather than "the one at level − 1", which would
 * find no candidate and cut the chain short.
 */
function buildLongestChain(courses: BuiltCourse[], byId: Map<string, BuiltCourse>): string[] {
  const deepest = courses.reduce<BuiltCourse | null>(
    (best, course) => (!best || course.level > best.level ? course : best),
    null
  );
  if (!deepest) return [];

  const chain: string[] = [deepest.id];
  let current = deepest;
  while (current.deps.length) {
    const next = current.deps
      .map((id) => byId.get(id))
      .filter((course): course is BuiltCourse => course !== undefined)
      .sort((a, b) => b.level - a.level)[0];
    if (!next) break;
    chain.unshift(next.id);
    current = next;
  }
  return chain;
}

/* ────────────────────────────────  Crawl  ──────────────────────────────── */

const WINDOW_DAYS = 90;

/** Seconds a person spends on one review decision. One keystroke, plus reading the title. */
const SECONDS_PER_DECISION = 4;

/**
 * What one queued `videos` job costs, in quota units.
 *
 * Walking a playlist takes two endpoints and both page fifty at a time:
 * `playlistItems.list` for the ids, `videos.list` for the durations. So the
 * cost is `2 × ceil(videoCount / 50)`, and a playlist of any length under
 * fifty is the same two units as an empty one.
 */
const UNITS_PER_JOB = `2 * MAX(1, (COALESCE(p.video_count, 0) + 49) / 50)`;

type CrawlContext = {
  publishedPlaylists: number;
  publishedCourses: number;
  emptyCourses: string[];
};

function collectCrawl(notes: string[], context: CrawlContext): CrawlStats | null {
  if (!dbExists()) {
    notes.push('data/cache.db нет — раздел обхода пропущен (он не коммитится, см. .gitignore)');
    return null;
  }

  const db = openDb({ readonly: true });
  try {
    const one = <T>(sql: string, ...args: unknown[]): T => db.prepare(sql).get(...args) as T;
    const all = <T>(sql: string, ...args: unknown[]): T[] => db.prepare(sql).all(...args) as T[];
    const count = (sql: string, ...args: unknown[]): number =>
      one<{ n: number }>(`SELECT count(*) AS n FROM ${sql}`, ...args).n;

    const channels = count('channels');
    const discovered = count('playlists');
    const withVideos = count('playlists WHERE videos_fetched_at IS NOT NULL');
    const bound = count(
      `matches WHERE course_id IS NOT NULL AND (reviewed = 1 OR confidence >= ?)`,
      MATCH_THRESHOLD
    );
    const rejected = count('matches WHERE course_id IS NULL');
    const reviewed = count('matches WHERE reviewed = 1');
    const pending = count(
      `matches WHERE course_id IS NOT NULL AND reviewed = 0 AND confidence < ?`,
      MATCH_THRESHOLD
    );
    const unclassified = count(
      'playlists WHERE id NOT IN (SELECT playlist_id FROM matches)'
    );
    const videos = count('videos');
    const raw = count('raw_responses');
    const deadPlaylists = count('playlists WHERE alive = 0');

    // One window for every daily chart, taken from the first day anything was
    // recorded — see `windowDays`.
    const earliest = one<{ day: string | null }>(
      `SELECT min(day) AS day FROM (
         SELECT min(date) AS day FROM quota
         UNION ALL SELECT min(substr(updated_at, 1, 10)) FROM matches
         UNION ALL SELECT min(substr(checked_at, 1, 10)) FROM playlists
       )`
    ).day;
    const days = windowDays(earliest, 14, WINDOW_DAYS);

    const quotaByDay = dailyWindow(
      new Map(
        // Summed over the keys: the ledger holds a row per key per day, and a
        // chart of the day's spending wants the day, not one key's share of it.
        all<{ date: string; spent: number }>(
          'SELECT date, sum(spent) AS spent FROM quota GROUP BY date ORDER BY date'
        ).map((row) => [row.date, row.spent])
      ),
      days
    );

    const matchDays = new Map(
      all<{ d: string; n: number }>(
        `SELECT substr(updated_at, 1, 10) AS d, count(*) AS n FROM matches
         WHERE updated_at IS NOT NULL GROUP BY d ORDER BY d`
      ).map((row) => [row.d, row.n])
    );
    const matchesByDay = dailyWindow(matchDays, days);
    // Everything decided before the window opened is the starting height, so
    // the curve reads as the catalogue's real size rather than as a fresh start.
    const before =
      count('matches') - matchesByDay.reduce((sum, point) => sum + point.value, 0);

    const checksByDay = dailyWindow(
      new Map(
        all<{ d: string; n: number }>(
          `SELECT substr(checked_at, 1, 10) AS d, count(*) AS n FROM playlists
           WHERE checked_at IS NOT NULL GROUP BY d ORDER BY d`
        ).map((row) => [row.d, row.n])
      ),
      days
    );

    const videosByYear = all<{ y: string; n: number }>(
      `SELECT substr(published_at, 1, 4) AS y, count(*) AS n FROM videos
       WHERE published_at IS NOT NULL AND published_at >= '2006' GROUP BY y ORDER BY y`
    ).map((row) => ({ label: row.y, value: row.n }));

    const freshness: Bar[] = [
      { label: 'за сутки', value: freshCount(db, 1), tone: 'accent' },
      { label: 'за неделю', value: freshCount(db, 7), tone: 'accent' },
      { label: 'за месяц', value: freshCount(db, 30), tone: 'series' },
      {
        label: 'давно или никогда',
        value: discovered - freshCount(db, 30),
        tone: 'warning',
      },
    ];

    const jobRows = all<{ type: string; status: string; n: number }>(
      'SELECT type, status, count(*) AS n FROM jobs GROUP BY type, status'
    );
    const jobs = new Map<string, JobRow>();
    for (const row of jobRows) {
      const entry = jobs.get(row.type) ?? {
        type: row.type,
        done: 0,
        pending: 0,
        error: 0,
        other: 0,
      };
      if (row.status === 'done') entry.done += row.n;
      else if (row.status === 'pending') entry.pending += row.n;
      else if (row.status === 'error') entry.error += row.n;
      else entry.other += row.n;
      jobs.set(row.type, entry);
    }

    const confidence: Point[] = Array.from({ length: 10 }, (_, bin) => ({
      label: (bin / 10).toFixed(1),
      value: one<{ n: number }>(
        `SELECT count(*) AS n FROM matches
         WHERE course_id IS NOT NULL AND confidence >= ? AND confidence < ?`,
        bin / 10,
        bin / 10 + 0.1
      ).n,
    }));

    const dbSizeMb = fs.existsSync(paths.cacheDb)
      ? fs.statSync(paths.cacheDb).size / (1024 * 1024)
      : 0;

    return {
      dbSizeMb,
      forecast: buildForecast(db, context),
      facts: [
        { label: 'Каналов', value: fmt(channels), hint: 'источники обхода' },
        { label: 'Плейлистов в кеше', value: fmt(discovered), hint: 'найдено на YouTube' },
        { label: 'Видео в кеше', value: fmt(videos) },
        {
          label: 'Ответов API',
          value: fmt(raw),
          hint: 'сохранены целиком, чтобы не тратить квоту на повтор',
        },
        { label: 'Размер cache.db', value: `${dbSizeMb.toFixed(0)} МБ` },
        {
          label: 'Квота сегодня',
          value: fmt(quotaByDay[quotaByDay.length - 1]?.value ?? 0),
          hint: 'из 10 000 единиц в сутки',
        },
        { label: 'Недоступных', value: fmt(deadPlaylists), hint: 'alive = 0' },
        {
          label: 'Размечено вручную',
          value: fmt(reviewed),
          hint: 'решений через pnpm data:review',
        },
      ],
      // No separate "has metadata" step: `stats_fetched_at` is written by the
      // video pass, not by the metadata one, so it would always equal the step
      // below it and read as a stage that never loses anything.
      funnel: [
        { label: 'найдено при обходе каналов', value: discovered },
        { label: 'лекции выкачаны', value: withVideos },
        { label: 'привязано к курсу', value: bound },
        { label: 'в каталоге', value: context.publishedPlaylists },
      ],
      quotaByDay,
      matchesByDay,
      matchesCumulative: running(matchesByDay, before),
      checksByDay,
      videosByYear,
      freshness,
      jobs: [...jobs.values()].sort((a, b) => a.type.localeCompare(b.type)),
      matchMethods: topBars(
        new Map(
          all<{ method: string; n: number }>(
            'SELECT method, count(*) AS n FROM matches GROUP BY method ORDER BY n DESC'
          ).map((row) => [row.method || 'без метода', row.n])
        ),
        8
      ),
      confidence,
      queue: [
        { label: 'привязано', value: bound, tone: 'accent' },
        { label: 'ждёт просмотра', value: pending, tone: 'warning' },
        { label: 'ещё не классифицировано', value: unclassified, tone: 'warning' },
        { label: '«не курс»', value: rejected, tone: 'muted' },
      ],
      topChannels: topBars(
        new Map(
          all<{ channel: string; n: number }>(
            `SELECT COALESCE(c.title, p.channel_id) AS channel, count(*) AS n
             FROM playlists p LEFT JOIN channels c ON c.id = p.channel_id
             GROUP BY channel ORDER BY n DESC LIMIT 200`
          ).map((row) => [row.channel, row.n])
        ),
        12,
        'остальные каналы'
      ),
    };
  } finally {
    db.close();
  }
}

/**
 * The estimate: what is left, in quota and in evenings.
 *
 * The split that matters is between a queued job that can still reach the
 * catalogue and one that cannot. A playlist already decided «not a course»
 * stays in the queue until it is claimed, and paying for it buys nothing — so
 * the honest "how much more quota" is the first number, not the queue length.
 */
function buildForecast(db: Db, context: CrawlContext): Forecast {
  // `running` counts with `pending`: a job a killed process left behind is
  // recovered by the next run, so it is work outstanding either way.
  const cost = db
    .prepare(
      `SELECT
         CASE WHEN m.course_id IS NULL AND m.playlist_id IS NOT NULL THEN 1 ELSE 0 END AS ruled_out,
         count(*) AS playlists,
         COALESCE(sum(${UNITS_PER_JOB}), 0) AS units,
         COALESCE(sum(p.video_count), 0) AS videos
       FROM jobs j
       LEFT JOIN playlists p ON p.id = j.target
       LEFT JOIN matches m ON m.playlist_id = j.target
       WHERE j.type = 'videos' AND j.status IN ('pending', 'running')
       GROUP BY ruled_out`
    )
    .all() as Array<{ ruled_out: number; playlists: number; units: number; videos: number }>;

  const nothing = { playlists: 0, units: 0, videos: 0 };
  const useful = cost.find((row) => row.ruled_out === 0) ?? nothing;
  const wasted = cost.find((row) => row.ruled_out === 1) ?? nothing;
  const queued = {
    playlists: useful.playlists + wasted.playlists,
    units: useful.units + wasted.units,
    videos: useful.videos + wasted.videos,
  };

  const queue = db
    .prepare(
      `SELECT course_id AS course, count(*) AS n FROM matches
       WHERE course_id IS NOT NULL AND reviewed = 0 AND confidence < ?
       GROUP BY course_id`
    )
    .all(MATCH_THRESHOLD) as Array<{ course: string; n: number }>;

  const empty = new Set(context.emptyCourses);
  const fillable = queue.filter((row) => empty.has(row.course));
  const inReview = queue.reduce((sum, row) => sum + row.n, 0);

  const covered = context.publishedCourses;
  const total = covered + empty.size;
  const projected = total ? (covered + fillable.length) / total : 0;

  // Against every key together: a second project halves the days left.
  const perDay = dailyQuota();
  const days = Math.ceil(useful.units / perDay);
  const totalDays = Math.ceil(queued.units / perDay);
  const hours = (inReview * SECONDS_PER_DECISION) / HOUR;
  const dayText = days <= 1 ? 'меньше дня квоты' : `${days} дн квоты`;

  // Metadata and liveness are not queued — each is a scan over its own window,
  // so what is left of them is a date rather than a number of units. Both are
  // cheap besides: fifty playlists to a unit, against two per playlist walked.
  const now = Date.now();
  const scheduled = [
    {
      label: 'Метаданные',
      due: countAlive(db, 'next_refresh_at IS NULL OR next_refresh_at <= ?', iso(now)),
      // Discovery schedules a playlist a month out, so the soonest date in the
      // column is when the next pass has anything to do.
      when: minAlive(db, 'next_refresh_at'),
      after: 0,
    },
    {
      label: 'Доступность',
      due: countAlive(
        db,
        'checked_at IS NULL OR checked_at <= ?',
        iso(now - REFRESH_DAYS.liveness * 24 * HOUR * 1000)
      ),
      when: minAlive(db, 'checked_at'),
      after: REFRESH_DAYS.liveness,
    },
  ].map((row) => ({
    label: row.label,
    due: row.due,
    when: row.when ? iso(Date.parse(row.when) + row.after * 24 * HOUR * 1000) : null,
  }));

  return {
    ceiling: perDay,
    useful: { playlists: useful.playlists, units: useful.units, days },
    total: { ...queued, days: totalDays },
    scheduled,
    wasted: { playlists: wasted.playlists, units: wasted.units },
    review: { playlists: inReview, courses: queue.length, hours },
    fillable: {
      courses: fillable.length,
      candidates: fillable.reduce((sum, row) => sum + row.n, 0),
    },
    unsourced: empty.size - fillable.length,
    projectedCoverage: projected,
    facts: [
      {
        label: 'Дообойти текущие каналы',
        value: totalDays === 1 ? '1 день' : `${totalDays} дн`,
        hint: `${fmt(queued.units)} единиц на ${fmt(queued.playlists)} плейлистов (${fmt(
          queued.videos
        )} лекций) при потолке ${fmt(perDay)} в сутки`,
      },
      {
        label: 'Осталось полезного обхода',
        value: `${fmt(useful.units)} ед.`,
        hint: `${fmt(useful.playlists)} плейлистов · ${dayText}`,
      },
      {
        label: 'Квоты уйдёт впустую',
        value: `${fmt(wasted.units)} ед.`,
        hint: `${fmt(wasted.playlists)} заданий на плейлисты, уже отмеченные «не курс»`,
      },
      {
        label: 'Очередь просмотра',
        value: fmt(inReview),
        hint: `${fmt(queue.length)} курсов · ≈${fmt(hours)} ч по ${SECONDS_PER_DECISION} с на решение`,
      },
      {
        label: 'Закроет пустых курсов',
        value: fmt(fillable.length),
        hint: `${fmt(fillable.reduce((sum, row) => sum + row.n, 0))} кандидатов уже в кеше`,
      },
      {
        label: 'Покрытие после просмотра',
        value: `${(projected * 100).toFixed(1).replace('.', ',')}%`,
        hint: 'без единой единицы квоты',
      },
      {
        label: 'Курсов без источников',
        value: fmt(empty.size - fillable.length),
        hint: 'в кеше нет ни одного кандидата — нужны новые каналы в data/channels.yaml',
      },
    ],
  };
}

const iso = (at: number): string => new Date(at).toISOString();

function countAlive(db: Db, where: string, ...args: string[]): number {
  const row = db
    .prepare(`SELECT count(*) AS n FROM playlists WHERE alive = 1 AND (${where})`)
    .get(...args) as { n: number };
  return row.n;
}

function minAlive(db: Db, column: string): string | null {
  const row = db
    .prepare(`SELECT min(${column}) AS at FROM playlists WHERE alive = 1`)
    .get() as { at: string | null };
  return row.at;
}

function freshCount(db: Db, days: number): number {
  const since = new Date(Date.now() - days * 24 * HOUR * 1000).toISOString();
  const row = db
    .prepare('SELECT count(*) AS n FROM playlists WHERE checked_at >= ?')
    .get(since) as { n: number };
  return row.n;
}

/* ───────────────────────────────  Curation  ────────────────────────────── */

function collectCuration(): CurationStats {
  const overrides = loadYamlObject(path.join(paths.data, 'overrides.yaml'), OverridesSchema);
  const decisions = Object.values(overrides.matches);
  const bound = decisions.filter((value) => value !== null).length;
  const rejected = decisions.length - bound;
  const hidden = Object.values(overrides.playlists).filter((patch) => patch.hidden).length;
  const lecturers = Object.values(overrides.playlists).filter((patch) => patch.lecturer).length;

  const i18n = readJson<Record<string, string>>(path.join(paths.i18n, 'ru.json')) ?? {};
  const keys = Object.keys(i18n);
  const titles = keys.filter((key) => key.startsWith('course.') && key.endsWith('.title')).length;
  const descriptions = keys.filter(
    (key) => key.startsWith('course.') && key.endsWith('.desc')
  ).length;

  return {
    facts: [
      { label: 'Решений о привязке', value: fmt(decisions.length), hint: 'data/overrides.yaml' },
      { label: 'Правок плейлистов', value: fmt(Object.keys(overrides.playlists).length) },
      { label: 'Каналов размечено', value: fmt(Object.keys(overrides.channels).length) },
      { label: 'Строк перевода', value: fmt(keys.length), hint: 'data/i18n/ru.json' },
      { label: 'Названий курсов', value: fmt(titles) },
      { label: 'Описаний курсов', value: fmt(descriptions) },
    ],
    overrides: [
      { label: 'привязано вручную', value: bound, tone: 'accent' },
      { label: 'отмечено «не курс»', value: rejected, tone: 'muted' },
      { label: 'указан преподаватель', value: lecturers, tone: 'series' },
      { label: 'скрыто', value: hidden, tone: 'danger' },
    ],
  };
}

/* ─────────────────────────────────  Entry  ─────────────────────────────── */

const NUMBER = new Intl.NumberFormat('ru-RU');

export function fmt(value: number): string {
  return NUMBER.format(Math.round(value));
}

/**
 * A big number shortened to fit a tile. Ten digits of view count set the width
 * of the whole row and are read as "a lot" anyway; the exact figure moves to
 * the hint, where it is still there for anyone who wants it.
 */
export function compact(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1).replace('.', ',')} млрд`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace('.', ',')} млн`;
  return fmt(value);
}

export function collectStats(): Stats {
  const notes: string[] = [];
  const catalog = collectCatalog(notes);
  const crawl = collectCrawl(notes, {
    publishedPlaylists: catalog?.meta.playlists ?? 0,
    publishedCourses: catalog?.hero.covered ?? 0,
    emptyCourses: catalog?.emptyCourses ?? [],
  });
  return {
    generatedAt: new Date().toISOString(),
    notes,
    catalog,
    crawl,
    curation: collectCuration(),
  };
}
