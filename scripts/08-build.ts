import fs from 'node:fs';
import path from 'node:path';
import {
  BuiltCourseSchema,
  BuiltDomainSchema,
  BuiltPlaylistSchema,
  BuiltProviderSchema,
  lectureLengthOf,
  type BuiltCourse,
  type BuiltDomain,
  type BuiltPlaylist,
  type BuiltProvider,
  type Meta,
  type SearchEntry,
} from '../shared/schema.js';
import { normalize } from '../shared/search.js';
import { ensureDir, nowIso, paths } from './lib/config.js';
import {
  assertAcyclic,
  computeLevels,
  computeReachDown,
  computeReachUp,
  GraphError,
  symmetrizeRelated,
  validateReferences,
} from './lib/graph.js';
import { graphBounds, layoutCourses } from './lib/layout.js';
import { bayesianScore, engagementOf, meanEngagement, median, scoreToPercent } from './lib/score.js';
import { loadSources, reportSourceError, SourceError, type Sources } from './lib/sources.js';
import { dbExists, openDb, type MatchRow, type PlaylistRow, type VideoRow, type ChannelRow } from './lib/db.js';
import { detectCompleteness, detectKind, detectLang, detectLecturer } from './lib/classify.js';

/**
 * Builds everything under public/data from the YAML sources plus cache.db.
 *
 * The cycle check in step 2 is the most valuable thing this pipeline does: it
 * catches markup errors that are invisible to the eye and would otherwise
 * quietly produce a graph where a course requires itself three hops later.
 */

const BUILD_VERSION = '1';

type Assembled = {
  playlistsByCourse: Map<string, BuiltPlaylist[]>;
  total: number;
};

async function main(): Promise<void> {
  const started = Date.now();
  const lang = process.env.DEFAULT_LANG ?? 'ru';

  // 1. Sources ------------------------------------------------------------
  const sources = loadSources(lang);
  console.log(
    `· sources: ${sources.domains.length} domains, ${sources.courses.length} courses, ` +
      `${sources.providers.length} providers`
  );

  const domainIds = new Set(sources.domains.map((d) => d.id));
  for (const domain of sources.domains) {
    for (const dep of domain.dependsOn) {
      if (!domainIds.has(dep)) {
        throw new SourceError(`domains.yaml: ${domain.id}.dependsOn → unknown domain "${dep}"`);
      }
    }
    if (domain.parent && !domainIds.has(domain.parent)) {
      throw new SourceError(`domains.yaml: ${domain.id}.parent → unknown domain "${domain.parent}"`);
    }
  }

  symmetrizeRelated(sources.courses);
  validateReferences(sources.courses, domainIds);

  // 2. Cycles -------------------------------------------------------------
  assertAcyclic(sources.courses);
  console.log('· deps graph is acyclic');

  // 3. Levels and reachability -------------------------------------------
  const levels = computeLevels(sources.courses);
  const reachUp = computeReachUp(sources.courses);
  const reachDown = computeReachDown(sources.courses);
  const maxLevel = Math.max(...levels.values());
  console.log(`· levels computed, deepest chain is ${maxLevel + 1} courses long`);

  // 4. Layout -------------------------------------------------------------
  const positions = layoutCourses(sources.courses, levels);
  const bounds = graphBounds(positions);

  // 5. Playlists ----------------------------------------------------------
  const assembled = assemblePlaylists(sources);
  console.log(
    assembled.total
      ? `· ${assembled.total} playlists across ${assembled.playlistsByCourse.size} courses`
      : '· no cache.db (or no matched playlists) — building the graph without playlists'
  );

  // 6. Aggregates ---------------------------------------------------------
  const courses: BuiltCourse[] = sources.courses.map((course) => {
    const playlists = assembled.playlistsByCourse.get(course.id) ?? [];
    const position = positions.get(course.id)!;
    return BuiltCourseSchema.parse({
      ...course,
      level: levels.get(course.id) ?? 0,
      x: position.x,
      y: position.y,
      playlistCount: playlists.length,
      hours: playlists.length
        ? Math.round((median(playlists.map((p) => p.totalSeconds)) / 3600) * 10) / 10
        : 0,
      reachUp: reachUp.get(course.id) ?? [],
      reachDown: reachDown.get(course.id) ?? [],
    });
  });

  const coursesById = new Map(courses.map((c) => [c.id, c]));

  const domains: BuiltDomain[] = sources.domains.map((domain) => {
    const own = courses.filter((c) => c.domains.includes(domain.id));
    return BuiltDomainSchema.parse({
      ...domain,
      courseCount: own.length,
      playlistCount: own.reduce((sum, c) => sum + c.playlistCount, 0),
      hours: Math.round(own.reduce((sum, c) => sum + c.hours, 0)),
    });
  });

  const providers = buildProviders(sources, assembled, coursesById);

  // 7. Search index -------------------------------------------------------
  const searchIndex = buildSearchIndex(sources, courses, domains, providers, assembled);
  console.log(`· search index: ${searchIndex.length} entries`);

  // 8. Write --------------------------------------------------------------
  ensureDir(paths.outData);
  ensureDir(paths.outPlaylists);
  ensureDir(path.join(paths.outData, 'i18n'));

  writeJson(path.join(paths.outData, 'domains.json'), domains);
  writeJson(path.join(paths.outData, 'courses.json'), {
    bounds,
    maxLevel,
    courses,
  });
  writeJson(path.join(paths.outData, 'providers.json'), providers);
  writeJson(path.join(paths.outData, 'search-index.json'), searchIndex);
  writeJson(path.join(paths.outData, 'i18n', `${lang}.json`), sources.i18n);

  // Stale shards from courses that no longer exist would be served forever.
  for (const file of fs.readdirSync(paths.outPlaylists)) {
    if (file.endsWith('.json')) fs.rmSync(path.join(paths.outPlaylists, file));
  }
  for (const [courseId, playlists] of assembled.playlistsByCourse) {
    writeJson(path.join(paths.outPlaylists, `${courseId}.json`), playlists);
  }

  // 9. Meta ---------------------------------------------------------------
  const withMaterials = courses.filter((c) => c.playlistCount > 0).length;
  const meta: Meta = {
    version: BUILD_VERSION,
    builtAt: nowIso(),
    courses: courses.length,
    domains: domains.length,
    playlists: assembled.total,
    providers: Object.keys(providers).length,
    coverage: courses.length ? Math.round((withMaterials / courses.length) * 1000) / 1000 : 0,
    maxLevel,
  };
  writeJson(path.join(paths.outData, 'meta.json'), meta);

  console.log(
    `✓ built in ${Date.now() - started} ms · coverage ${(meta.coverage * 100).toFixed(1)}% ` +
      `(${withMaterials}/${courses.length} courses have materials)`
  );
}

/* ────────────────────────────  Playlist assembly  ──────────────────────── */

function assemblePlaylists(sources: Sources): Assembled {
  const byCourse = new Map<string, BuiltPlaylist[]>();
  if (!dbExists()) return { playlistsByCourse: byCourse, total: 0 };

  const db = openDb({ readonly: true });
  try {
    const playlistRows = db.prepare(`SELECT * FROM playlists WHERE alive = 1`).all() as PlaylistRow[];
    if (!playlistRows.length) return { playlistsByCourse: byCourse, total: 0 };

    const matchRows = db.prepare(`SELECT * FROM matches`).all() as MatchRow[];
    const matches = new Map(matchRows.map((m) => [m.playlist_id, m]));

    const channelRows = db.prepare(`SELECT * FROM channels`).all() as ChannelRow[];
    const channels = new Map(channelRows.map((c) => [c.id, c]));

    const videoRows = db
      .prepare(`SELECT id, playlist_id, position, title, duration_seconds FROM videos ORDER BY playlist_id, position`)
      .all() as VideoRow[];
    const videosByPlaylist = new Map<string, VideoRow[]>();
    for (const video of videoRows) {
      const list = videosByPlaylist.get(video.playlist_id) ?? [];
      list.push(video);
      videosByPlaylist.set(video.playlist_id, list);
    }

    const courseIds = new Set(sources.courses.map((c) => c.id));
    const providerIds = new Set(sources.providers.map((p) => p.id));
    const yamlChannels = new Map(sources.channels.map((c) => [c.id, c]));

    // First pass: raw objects, so the catalogue mean is known before scoring.
    const staged: Array<{ courseId: string; playlist: Omit<BuiltPlaylist, 'score' | 'scorePercent'> }> = [];

    for (const row of playlistRows) {
      const override = sources.overrides.playlists[row.id];
      if (override?.hidden) continue;

      const courseId = resolveCourse(row.id, matches, sources);
      if (!courseId || !courseIds.has(courseId)) continue;

      const channel = channels.get(row.channel_id);
      const providerId = resolveProvider(row.channel_id, channel, yamlChannels, sources, providerIds);

      const videos = (videosByPlaylist.get(row.id) ?? []).map((v) => ({
        id: v.id,
        title: v.title,
        seconds: v.duration_seconds ?? 0,
      }));

      const durations = videos.map((v) => v.seconds).filter((s) => s > 0);
      const totalSeconds = row.total_seconds ?? durations.reduce((a, b) => a + b, 0);
      const medianSeconds = row.median_seconds ?? median(durations);
      const videoCount = row.video_count ?? videos.length;

      const stats = {
        views: row.views ?? 0,
        likes: row.likes ?? 0,
        comments: row.comments ?? 0,
        fetchedAt: row.stats_fetched_at ?? nowIso(),
      };

      const title = override?.title ?? row.title;
      const captions = override?.captions ?? (row.captions ? row.captions.split(',').filter(Boolean) : []);

      staged.push({
        courseId,
        playlist: {
          id: row.id,
          courseId,
          title,
          channelId: row.channel_id,
          channelTitle: channel?.title ?? yamlChannels.get(row.channel_id)?.title ?? '',
          providerId,
          lecturer: override?.lecturer ?? detectLecturer(title),
          lang: override?.lang ?? row.lang ?? detectLang(title, yamlChannels.get(row.channel_id)?.lang ?? 'ru'),
          captions,
          year: override?.year ?? (row.published_at ? new Date(row.published_at).getUTCFullYear() : undefined),
          videoCount,
          totalSeconds,
          medianSeconds,
          kind: override?.kind ?? detectKind(title, row.description ?? ''),
          completeness:
            override?.completeness ?? detectCompleteness(title, videoCount, row.description ?? ''),
          stats,
          alive: true,
          checkedAt: row.checked_at ?? nowIso(),
          lectureLength: lectureLengthOf(medianSeconds),
          engagement: engagementOf(stats),
          videos,
        },
      });
    }

    const catalogueMean = meanEngagement(staged.map((s) => s.playlist.stats));

    for (const { courseId, playlist } of staged) {
      const score = bayesianScore(playlist.stats, catalogueMean);
      const built = BuiltPlaylistSchema.parse({
        ...playlist,
        score,
        // Mapped here rather than on the client, which would otherwise need the
        // catalogue mean shipped alongside every shard to say anything.
        scorePercent: scoreToPercent(score, catalogueMean),
      });
      const list = byCourse.get(courseId) ?? [];
      list.push(built);
      byCourse.set(courseId, list);
    }

    // Default order inside a shard is the default sort in the UI.
    for (const list of byCourse.values()) list.sort((a, b) => b.score - a.score);

    return { playlistsByCourse: byCourse, total: staged.length };
  } finally {
    db.close();
  }
}

/** `overrides.yaml` always wins over whatever the matcher decided. */
function resolveCourse(
  playlistId: string,
  matches: Map<string, MatchRow>,
  sources: Sources
): string | null {
  if (playlistId in sources.overrides.matches) {
    return sources.overrides.matches[playlistId];
  }
  const match = matches.get(playlistId);
  if (!match?.course_id) return null;
  // Unreviewed low-confidence guesses stay out of the catalogue.
  if (!match.reviewed && match.confidence < 0.75) return null;
  return match.course_id;
}

function resolveProvider(
  channelId: string,
  channel: ChannelRow | undefined,
  yamlChannels: Map<string, { providerId: string }>,
  sources: Sources,
  providerIds: Set<string>
): string {
  const candidate =
    sources.overrides.channels[channelId] ??
    channel?.provider_id ??
    yamlChannels.get(channelId)?.providerId ??
    'unknown';
  return providerIds.has(candidate) ? candidate : 'unknown';
}

/* ──────────────────────────────  Providers  ────────────────────────────── */

function buildProviders(
  sources: Sources,
  assembled: Assembled,
  coursesById: Map<string, BuiltCourse>
): Record<string, BuiltProvider> {
  const stats = new Map<string, { count: number; courses: Set<string>; domains: Set<string> }>();

  for (const playlists of assembled.playlistsByCourse.values()) {
    for (const playlist of playlists) {
      const entry = stats.get(playlist.providerId) ?? {
        count: 0,
        courses: new Set<string>(),
        domains: new Set<string>(),
      };
      entry.count += 1;
      entry.courses.add(playlist.courseId);
      for (const domain of coursesById.get(playlist.courseId)?.domains ?? []) {
        entry.domains.add(domain);
      }
      stats.set(playlist.providerId, entry);
    }
  }

  const result: Record<string, BuiltProvider> = {};
  for (const provider of sources.providers) {
    const entry = stats.get(provider.id);
    result[provider.id] = BuiltProviderSchema.parse({
      ...provider,
      playlistCount: entry?.count ?? 0,
      courseIds: [...(entry?.courses ?? [])].sort(),
      domainIds: [...(entry?.domains ?? [])].sort(),
    });
  }
  return result;
}

/* ────────────────────────────  Search index  ───────────────────────────── */

function buildSearchIndex(
  sources: Sources,
  courses: BuiltCourse[],
  domains: BuiltDomain[],
  providers: Record<string, BuiltProvider>,
  assembled: Assembled
): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const t = (key: string, fallback: string): string => sources.i18n[key] ?? fallback;

  /** Keywords are normalised here so the client compares like with like. */
  const keywordsFor = (key: string, ...extra: string[]): string[] => {
    const set = new Set<string>();
    for (const word of [...(sources.keywords[key] ?? []), ...extra]) {
      const normalised = normalize(word);
      if (normalised) set.add(normalised);
    }
    return [...set];
  };

  for (const domain of domains) {
    const title = t(`domain.${domain.id}.title`, domain.id);
    entries.push({
      t: 'd',
      id: domain.id,
      n: title,
      k: keywordsFor(`domain.${domain.id}`, title, domain.id.replace(/-/g, ' ')),
      s: domain.courseCount,
    });
  }

  for (const course of courses) {
    const title = t(`course.${course.id}.title`, course.id);
    entries.push({
      t: 'c',
      id: course.id,
      n: title,
      k: keywordsFor(`course.${course.id}`, title, course.id.replace(/-/g, ' ')),
      s: course.playlistCount,
    });
  }

  const lecturers = new Map<string, number>();
  for (const playlists of assembled.playlistsByCourse.values()) {
    for (const playlist of playlists) {
      entries.push({
        t: 'p',
        id: playlist.id,
        n: playlist.title,
        k: keywordsFor(`playlist.${playlist.id}`, playlist.title, playlist.channelTitle),
        s: Math.round(playlist.score * 1000),
        // Selecting a playlist has to open its course first, so the shard it
        // lives in must be known without loading every shard to find it.
        c: playlist.courseId,
      });
      if (playlist.lecturer) {
        lecturers.set(playlist.lecturer, (lecturers.get(playlist.lecturer) ?? 0) + 1);
      }
    }
  }

  for (const provider of Object.values(providers)) {
    entries.push({
      t: 'v',
      id: provider.id,
      n: provider.title,
      k: keywordsFor(`provider.${provider.id}`, provider.title, provider.id.replace(/-/g, ' ')),
      s: provider.playlistCount,
    });
  }

  for (const [lecturer, count] of lecturers) {
    entries.push({
      t: 'l',
      id: lecturer,
      n: lecturer,
      k: keywordsFor(`lecturer.${lecturer}`, lecturer),
      s: count,
    });
  }

  return entries;
}

/* ────────────────────────────────  Output  ─────────────────────────────── */

function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}

main().catch((error) => {
  if (error instanceof GraphError) {
    console.error(`\n✗ ${error.message}`);
    for (const detail of error.details) console.error(`  ${detail}`);
    process.exit(1);
  }
  reportSourceError(error);
});
