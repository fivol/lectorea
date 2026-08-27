import fs from 'node:fs';
import path from 'node:path';
import {
  BuiltCourseSchema,
  BuiltDomainSchema,
  BuiltLecturerSchema,
  BuiltPlaylistSchema,
  BuiltProviderSchema,
  lectureLengthOf,
  UI_LANGS,
  type BuiltCourse,
  type BuiltDomain,
  type BuiltLecturer,
  type BuiltPlaylist,
  type BuiltProvider,
  type Course,
  type Meta,
  type SearchEntry,
} from '../shared/schema.js';
import { normalize } from '../shared/search.js';
import { ensureDir, nowIso, paths } from './lib/config.js';
import {
  buildLevels,
  findGraphWarnings,
  GraphError,
  symmetrizeRelated,
  validateFilePlacement,
  validateReferences,
} from './lib/graph.js';
import { layoutColumns } from './lib/layout.js';
import {
  clamp,
  audienceCurve,
  curveOf,
  durationSpreadOf,
  isCollection,
  isFullCourse,
  oddLengthShare,
  titlesOrdered,
  uploadSpanDays,
  engagementOf,
  isReversed,
  median,
  rateCatalogue,
  type StatusThresholds,
} from './lib/score.js';
import {
  boundCourses,
  loadAliases,
  loadDictionary,
  loadKeywords,
  loadSources,
  SourceError,
  type Sources,
} from './lib/sources.js';
import { reportRunError } from './lib/exit.js';
import { detectSeries } from './lib/series.js';
import {
  dbExists,
  isBindingConfident,
  openDb,
  type MatchRow,
  type VerdictRow,
  type PlaylistRow,
  type VideoRow,
  type ChannelRow,
} from './lib/db.js';
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
  /** What each status cost this build — written to meta.json so it stays checkable. */
  thresholds?: StatusThresholds;
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
  validateFilePlacement(sources.courses, sources.courseFiles);
  validateReferences(sources.courses, domainIds, sources.courseLocations);

  // 2. Levels, order and cycles — one pass of Kahn's algorithm -------------
  const { order, level: levels } = buildLevels(sources.courses);
  console.log(
    `· deps graph is acyclic, deepest chain is ${Math.max(...levels.values()) + 1} courses long`
  );

  // Not errors: markup that still builds but rots the graph if left alone.
  const warnings = findGraphWarnings(sources.courses, sources.courseLocations);
  for (const warning of warnings.slice(0, 20)) console.warn(`  ! ${warning}`);
  if (warnings.length > 20) console.warn(`  ! …and ${warnings.length - 20} more`);

  // 3. Playlists ----------------------------------------------------------
  const assembled = assemblePlaylists(sources);
  console.log(
    assembled.total
      ? `· ${assembled.total} playlists across ${assembled.playlistsByCourse.size} courses`
      : '· no cache.db (or no matched playlists) — building the graph without playlists'
  );

  // 4. What the catalogue shows -------------------------------------------
  const hidden = hiddenCourses(sources.courses, assembled.playlistsByCourse);
  const shownSources = sources.courses.filter((course) => !hidden.has(course.id));
  if (hidden.size) {
    console.log(`· ${hidden.size} courses hidden: nothing to watch and nothing needs them`);
  }

  // 5. Column order -------------------------------------------------------
  // Over the shown courses only: a row reserved for a card nobody draws is a
  // hole in the column.
  const layout = layoutColumns(shownSources, levels, sources.domains);

  // 6. Aggregates ---------------------------------------------------------
  // Written in topological order, which is also a sane reading order for the
  // file and lets the client trust that a dependency always appears earlier.
  const byId = new Map(sources.courses.map((course) => [course.id, course]));
  const courses: BuiltCourse[] = order.map((id) => {
    const course = byId.get(id)!;
    const playlists = assembled.playlistsByCourse.get(id) ?? [];
    return BuiltCourseSchema.parse({
      ...course,
      // Sideways links to a hidden course would render as a name that leads
      // nowhere. `deps` never point at one — that is what makes it hideable.
      soft: course.soft.filter((dep) => !hidden.has(dep)),
      related: course.related.filter((dep) => !hidden.has(dep)),
      level: levels.get(id) ?? 0,
      row: layout.row.get(id) ?? 0,
      playlistCount: playlists.length,
      playlistsByLang: playlists.reduce<Record<string, number>>((counts, playlist) => {
        const lang = playlist.lang || 'unknown';
        counts[lang] = (counts[lang] ?? 0) + 1;
        return counts;
      }, {}),
      hours: playlists.length
        ? Math.round((median(playlists.map((p) => p.totalSeconds)) / 3600) * 10) / 10
        : 0,
      ...(hidden.has(id) ? { hidden: true } : {}),
    });
  });

  // Everything the site is built from — counts, columns, the search index —
  // comes from these, so a hidden course cannot leak into a total anywhere.
  const shown = courses.filter((course) => !course.hidden);
  const maxLevel = shown.reduce((deepest, course) => Math.max(deepest, course.level), 0);

  const coursesById = new Map(courses.map((c) => [c.id, c]));

  const domains: BuiltDomain[] = sources.domains.map((domain) => {
    const own = shown.filter((c) => c.domains.includes(domain.id));
    return BuiltDomainSchema.parse({
      ...domain,
      courseCount: own.length,
      playlistCount: own.reduce((sum, c) => sum + c.playlistCount, 0),
      hours: Math.round(own.reduce((sum, c) => sum + c.hours, 0)),
    });
  });

  const providers = buildProviders(sources, assembled, coursesById);
  const lecturers = buildLecturers(assembled, coursesById);

  // 7. Search index -------------------------------------------------------
  const materials = buildMaterialEntries(sources, providers, lecturers, assembled);
  console.log(`· search index: ${materials.length} language-neutral entries`);

  // 8. Write --------------------------------------------------------------
  ensureDir(paths.outData);
  ensureDir(paths.outPlaylists);
  ensureDir(path.join(paths.outData, 'i18n'));

  writeJson(path.join(paths.outData, 'domains.json'), domains);
  writeJson(path.join(paths.outData, 'courses.json'), {
    maxLevel,
    columns: layout.columns,
    courses,
  });
  writeJson(path.join(paths.outData, 'providers.json'), providers);
  // Tiny beside the shards, and it is what lets naming a lecturer narrow the
  // columns and the map rather than only the list inside a course already open.
  writeJson(path.join(paths.outData, 'lecturers.json'), lecturers);
  // Playlists, channels and lecturers are named on YouTube, in whatever
  // language they were published in; no dictionary touches them. They are also
  // nine tenths of the index, so they ship once and are never fetched again.
  writeJson(path.join(paths.outData, 'search-index.json'), materials);

  // Everything that changes with the language lives under i18n/, so switching
  // costs those two small files rather than the catalogue.
  for (const entry of UI_LANGS) {
    const own = entry.id === lang;
    const dictionary = own ? sources.i18n : loadDictionary(entry.id);
    // A translated index keeps the content language's keywords as well as its
    // own. What a course is *called* has to follow the page, but what finds it
    // does not: the lectures are Russian, and someone reading the English
    // interface may well type «матан» at it. Only matching is widened —
    // whatever is found is still named in the language on screen.
    const keywords = own ? [sources.keywords] : [loadKeywords(entry.id), sources.keywords];
    // Aliases are searched like keywords and shown unlike them, so they ride
    // into the dictionary as `course.{id}.aliases` — one line under the title,
    // already joined, for the half of the catalogue whose recordings are titled
    // with a name that is not ours.
    const aliases = own ? sources.aliases : loadAliases(entry.id);
    const localised: Record<string, string> = { ...dictionary };
    for (const course of shown) {
      const named = aliases[`course.${course.id}`] ?? [];
      if (named.length) localised[`course.${course.id}.aliases`] = named.join(' · ');
    }
    const catalogue = buildCatalogueEntries(
      dictionary,
      [...keywords, aliases],
      shown,
      domains,
      aliases
    );
    writeJson(path.join(paths.outData, 'i18n', `${entry.id}.json`), localised);
    writeJson(path.join(paths.outData, 'i18n', `search-${entry.id}.json`), catalogue);
    console.log(
      `· i18n: ${entry.id} — ${Object.keys(dictionary).length} keys, ` +
        `${catalogue.length} searchable courses and fields`
    );
  }

  // Stale shards from courses that no longer exist would be served forever.
  for (const file of fs.readdirSync(paths.outPlaylists)) {
    if (file.endsWith('.json')) fs.rmSync(path.join(paths.outPlaylists, file));
  }
  for (const [courseId, playlists] of assembled.playlistsByCourse) {
    writeJson(path.join(paths.outPlaylists, `${courseId}.json`), playlists);
  }

  // 9. Meta ---------------------------------------------------------------
  // Counted over the whole catalogue, hidden courses included: coverage is the
  // measure of what is missing, and hiding a hole is not filling it.
  const withMaterials = courses.filter((c) => c.playlistCount > 0).length;
  const meta: Meta = {
    version: BUILD_VERSION,
    builtAt: nowIso(),
    courses: courses.length,
    hidden: hidden.size,
    domains: domains.length,
    playlists: assembled.total,
    providers: Object.keys(providers).length,
    coverage: courses.length ? Math.round((withMaterials / courses.length) * 1000) / 1000 : 0,
    maxLevel,
    statusThresholds: assembled.thresholds,
  };
  writeJson(path.join(paths.outData, 'meta.json'), meta);

  console.log(
    `✓ built in ${Date.now() - started} ms · coverage ${(meta.coverage * 100).toFixed(1)}% ` +
      `(${withMaterials}/${courses.length} courses have materials)` +
      (hidden.size ? ` · ${shown.length} shown, ${hidden.size} hidden` : '')
  );
}

/* ─────────────────────────────  What is shown  ─────────────────────────── */

/**
 * Courses the catalogue keeps but does not show.
 *
 * A course with no recordings is a card that answers nothing: it opens to an
 * empty panel, it pads the columns and the counts, and search finds it only to
 * disappoint. Deleting it is worse — the markup is right, the graph is right,
 * and the day a playlist matches it the course should simply come back — so it
 * is dropped from the site and kept in the data.
 *
 * The one thing hiding may not do is break a path. A course something visible
 * depends on stays, empty or not: «what has to come first» is the promise the
 * catalogue makes, and a missing link in that chain is a worse lie than a card
 * with nothing behind it. That makes it a fixpoint rather than a filter —
 * keeping one course brings back whatever it needs in turn.
 */
function hiddenCourses(
  courses: Course[],
  playlistsByCourse: Map<string, BuiltPlaylist[]>
): Set<string> {
  const hidden = new Set(
    courses.filter((course) => !playlistsByCourse.get(course.id)?.length).map((c) => c.id)
  );

  // Every pass un-hides the empty courses that something shown needs, which can
  // make their own dependencies needed in turn. At most one course comes back
  // per pass, so it settles in as many passes as there are chains of them.
  for (let changed = true; changed; ) {
    changed = false;
    for (const course of courses) {
      if (hidden.has(course.id)) continue;
      for (const dep of course.deps) {
        if (hidden.delete(dep)) changed = true;
      }
    }
  }
  return hidden;
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

    // What a reader made of each binding the rules accepted. Empty on a cache
    // that has never been reviewed, which is why `resolveCourses` says out loud
    // what an absent verdict means rather than defaulting to publish.
    const verdictRows = db.prepare(`SELECT * FROM verdicts`).all() as VerdictRow[];
    const verdicts = new Map(verdictRows.map((v) => [v.playlist_id, v]));

    const channelRows = db.prepare(`SELECT * FROM channels`).all() as ChannelRow[];
    const channels = new Map(channelRows.map((c) => [c.id, c]));

    /*
     * Who actually filmed a mirror.
     *
     * `14-authors.ts` keeps a playlist whose videos come from one outside
     * channel, because it is a real course and dropping it would delete
     * material that in most cases exists nowhere else here. What is wrong about
     * it is the name over it: the provider is read off whoever *listed* the
     * playlist, and for a mirror that is a re-uploader. «MIT 6.036
     * Introduction to Machine Learning» filed under an account that made none
     * of it is the shape.
     *
     * Fixed here rather than by hand in `overrides.channels`, because the
     * override is keyed by *channel* and the fault is per *playlist* — the same
     * re-uploader also posts its own material, and moving the whole channel
     * would mislabel that instead. One line of build instead of an entry per
     * playlist that somebody has to notice and write.
     */
    const realOwner = new Map<string, { id: string; title: string | null }>(
      (
        db
          .prepare(
            `SELECT playlist_id, owner_id, owner_title FROM ownership WHERE kind = 'mirror'`
          )
          .all() as Array<{ playlist_id: string; owner_id: string | null; owner_title: string | null }>
      )
        .filter((row) => Boolean(row.owner_id))
        .map((row) => [row.playlist_id, { id: row.owner_id!, title: row.owner_title }])
    );

    /*
     * And what nobody made: a playlist whose fifty sampled videos come from
     * forty channels is somebody's bookmarks, whatever its title claims.
     *
     * Read here rather than trusted to the `matches` row `14-authors.ts` also
     * writes, because that row is not a safe place to keep an answer — a
     * refusal by any pass is deliberately reversible and `data:match --force`
     * re-reads every one of them, so a keyword change silently republishes
     * collections that cost a unit each to identify. The evidence is in
     * `ownership` and does not expire; the build asks it directly and the two
     * steps stop being ordered.
     */
    const collections = new Set(
      (
        db
          .prepare(`SELECT playlist_id FROM ownership WHERE kind = 'collection'`)
          .all() as Array<{ playlist_id: string }>
      ).map((row) => row.playlist_id)
    );

    // `views` rides along for the rating: the shape of the view curve down a
    // playlist is the only thing in the data that says whether people stayed.
    const videoRows = db
      .prepare(
        `SELECT id, playlist_id, position, title, duration_seconds, views, published_at
         FROM videos ORDER BY playlist_id, position`
      )
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

    // First pass: raw objects. Nothing can be scored until every playlist is
    // known, because every signal is measured against the rest of the catalogue.
    type Staged = Omit<BuiltPlaylist, 'rating' | 'status' | 'signals'>;
    const staged: Array<{ courseIds: string[]; playlist: Staged }> = [];

    for (const row of playlistRows) {
      const override = sources.overrides.playlists[row.id];
      if (override?.hidden) continue;

      // One recording, possibly several courses: «Алгоритмы и структуры
      // данных» is one semester teaching two of ours, and it belongs in both
      // shards rather than in whichever we picked.
      const bound = resolveCourses(row.id, matches, sources, verdicts, collections).filter((id) =>
        courseIds.has(id)
      );
      if (!bound.length) continue;
      const courseId = bound[0];

      const channel = channels.get(row.channel_id);
      const providerId = resolveProvider(
        row.id,
        row.channel_id,
        channels,
        realOwner,
        yamlChannels,
        sources,
        providerIds
      );

      const videoRowsHere = videosByPlaylist.get(row.id) ?? [];
      const videos = videoRowsHere.map((v) => ({
        id: v.id,
        title: v.title,
        seconds: v.duration_seconds ?? 0,
      }));

      const dates = videoRowsHere.map((v) => v.published_at).filter((d): d is string => !!d);
      const lastVideoAt =
        row.last_video_at ?? (dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : undefined);
      // Half the catalogue's playlists are not in date order, which is fine —
      // position is the order they are watched in. The 67 that run newest-first
      // are not: read literally their audience grows towards the end.
      const chronological = !isReversed(dates);
      const curve = curveOf(
        videoRowsHere.map((v) => v.views),
        chronological
      );

      // How the playlist was made, which the curve alone gets wrong: a famous
      // course whose lectures are each found from search looks exactly like a
      // shelf until you notice it was filmed in one term, in equal slots, and
      // numbers its own titles. See `isCollection`.
      const structure = {
        ordered: titlesOrdered(videoRowsHere.map((v) => v.title ?? '')),
        spanDays: uploadSpanDays(videoRowsHere.map((v) => v.published_at)),
        durationSpread: durationSpreadOf(videoRowsHere.map((v) => v.duration_seconds)),
        oddLengths: oddLengthShare(videoRowsHere.map((v) => v.duration_seconds)),
        videoCount: row.video_count ?? videoRowsHere.length,
      };
      const collection = isCollection(curve, structure);
      const fullCourse = isFullCourse(structure);

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
        courseIds: bound,
        playlist: {
          id: row.id,
          courseId,
          alsoCourses: bound.slice(1),
          title,
          channelId: row.channel_id,
          // The same substitution as `providerId` and for the same reason: this
          // is the name the card prints under the title, and on a mirror the
          // listing channel is not who taught it. `owner_title` rather than the
          // channels table because the probe recorded it either way — a third
          // of the owners are channels this catalogue has never crawled, and
          // those are exactly the ones whose name it cannot otherwise print.
          channelTitle:
            realOwner.get(row.id)?.title ||
            channel?.title ||
            yamlChannels.get(row.channel_id)?.title ||
            '',
          providerId,
          lecturer: override?.lecturer ?? detectLecturer(title),
          lang: override?.lang ?? row.lang ?? detectLang(title, yamlChannels.get(row.channel_id)?.lang ?? 'ru'),
          captions,
          year: override?.year ?? (row.published_at ? new Date(row.published_at).getUTCFullYear() : undefined),
          videoCount,
          totalSeconds,
          medianSeconds,
          kind:
            override?.kind ??
            detectKind(
              title,
              row.description ?? '',
              videos.map((v) => v.title)
            ),
          completeness:
            override?.completeness ?? detectCompleteness(title, videoCount, row.description ?? ''),
          stats,
          alive: true,
          checkedAt: row.checked_at ?? nowIso(),
          // Null is «not asked yet», and the honest default for that is the way
          // the overwhelming majority behave: `data:embeds` names the few that
          // do not.
          listPlayable: row.list_playable !== 0,
          lectureLength: lectureLengthOf(medianSeconds),
          engagement: engagementOf(stats),
          retention: curve?.retention,
          curve: curve?.kind,
          // [game:audience] The same curve kept per lecture rather than
          // reduced to a ratio: about a byte a lecture, and the only thing in
          // the catalogue that can tell a reader eleven lectures into a
          // sixty-lecture course that they are further along than most of the
          // people who started it. See `audienceCurve`.
          audience: audienceCurve(
            videoRowsHere.map((v) => v.views),
            curve
          ),
          collection,
          fullCourse,
          oddLengths: structure.oddLengths ?? undefined,
          lastVideoAt,
          videos,
        },
      });
    }

    const rated = rateCatalogue(
      staged.map((s) => s.playlist),
      (channelId) => channels.get(channelId)?.subscribers ?? null
    );

    // Over the whole catalogue rather than one course at a time: a run is a
    // property of what a channel published, and both halves of it have to agree
    // on their numbering even when they end up in different courses.
    const series = detectSeries(
      staged.map(({ playlist }) => ({
        id: playlist.id,
        channelId: playlist.channelId,
        title: playlist.title,
        year: playlist.year,
      }))
    );

    for (const { courseIds: bound, playlist } of staged) {
      const built = BuiltPlaylistSchema.parse({
        ...playlist,
        ...rated.byId.get(playlist.id),
        ...(series.has(playlist.id) ? { series: series.get(playlist.id) } : {}),
      });
      for (const courseId of bound) {
        const list = byCourse.get(courseId) ?? [];
        list.push(built);
        byCourse.set(courseId, list);
      }
    }

    // Default order inside a shard is the default sort in the UI.
    for (const list of byCourse.values()) list.sort((a, b) => b.rating - a.rating);

    return { playlistsByCourse: byCourse, total: staged.length, thresholds: rated.thresholds };
  } finally {
    db.close();
  }
}

/**
 * Every course this playlist belongs to, the one it is filed under first.
 *
 * `overrides.yaml` always wins over whatever the matcher decided — including
 * when it names several courses, which the passes never do: a rule reads one
 * title and answers with one course, and only a person can say that a semester
 * called «Алгоритмы и структуры данных» is both of ours.
 */
function resolveCourses(
  playlistId: string,
  matches: Map<string, MatchRow>,
  sources: Sources,
  verdicts: Map<string, VerdictRow>,
  collections: Set<string>
): string[] {
  if (playlistId in sources.overrides.matches) {
    return boundCourses(sources.overrides.matches[playlistId]);
  }
  const match = matches.get(playlistId);
  if (!match?.course_id) return [];
  // Unreviewed low-confidence guesses stay out of the catalogue.
  if (!isBindingConfident(match)) return [];
  // A bag of other people's videos, however well its title names a course.
  // A person outranks the probe, as they outrank every pass here.
  if (collections.has(playlistId) && match.reviewed !== 1) return [];

  /*
   * The rules are the sieve; a reader is the confirmation.
   *
   * `lib/rules.ts` decides from a title, and a title cannot say that
   * «Trigonometry 3 - PRECALCULUS 8» is one topic of a course or that «Crash
   * Course in Music History» is not contemporary history. A sample of 120
   * published bindings was ~12% wrong in shapes exactly like those, every one
   * of them legible to somebody actually reading the line — so nothing reaches
   * the catalogue on the rules' word alone.
   *
   * A person still outranks everybody: `overrides.yaml` returned above, and
   * `reviewed = 1` never gets here without one.
   */
  /*
   * And the confirmation is of a *pairing*, not of a playlist. A reader was
   * shown «Fluid Mechanics» under transport phenomena and said yes to that
   * question; once a fluid mechanics course exists and the rules move the
   * playlist onto it, the yes is an answer to a question nobody asked. So a
   * verdict stamped with a different course counts as no verdict, and the
   * playlist goes back into the queue `_review.ts export` reads.
   *
   * Null is the one exception, and it means "written before the column
   * existed". Reading it as drift would take 5469 confirmations away at once.
   */
  const verdict = verdicts.get(playlistId);
  const stale = verdict?.course_id != null && verdict.course_id !== match.course_id;
  if (!verdict || stale) return match.reviewed === 1 ? [match.course_id] : [];
  if (verdict.verdict === 'ok') return [match.course_id];
  // A reader that moved the binding keeps it, under the course it named.
  if (verdict.verdict === 'wrong-course' && verdict.suggested_course) {
    return [verdict.suggested_course];
  }
  return [];
}

/**
 * Whose name goes over this playlist.
 *
 * Asked of the channel that **made** the videos where those differ from the one
 * that listed them — a mirror is a real course under a re-uploader's name, and
 * the provider is the only field that is wrong about it. The re-uploader is
 * still the fallback, and deliberately: when the true owner is a channel this
 * catalogue has never heard of, both sides answer `unknown` and there is
 * nothing to trade. Of the 75 mirrors found on 2026-08-17 this moved 26 off
 * `unknown` onto a real provider and took nothing off one — the remaining 49
 * have owners nobody here has crawled, and are the next channel hunt's input
 * (docs/channel-hunt.md).
 */
function resolveProvider(
  playlistId: string,
  listedBy: string,
  channels: Map<string, ChannelRow>,
  realOwner: Map<string, { id: string }>,
  yamlChannels: Map<string, { providerId: string }>,
  sources: Sources,
  providerIds: Set<string>
): string {
  const of = (channelId: string): string | null => {
    const candidate =
      sources.overrides.channels[channelId] ??
      channels.get(channelId)?.provider_id ??
      yamlChannels.get(channelId)?.providerId ??
      null;
    return candidate && providerIds.has(candidate) ? candidate : null;
  };

  const owner = realOwner.get(playlistId)?.id;
  return (owner ? of(owner) : null) ?? of(listedBy) ?? 'unknown';
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

/**
 * The lecturers the catalogue knows, keyed by the name written on their
 * recordings.
 *
 * Same shape as a provider, and for the same reason: the global filter has to
 * answer "which courses, which fields" from a name alone. See
 * `BuiltLecturerSchema`.
 */
function buildLecturers(
  assembled: Assembled,
  coursesById: Map<string, BuiltCourse>
): Record<string, BuiltLecturer> {
  const stats = new Map<string, { count: number; courses: Set<string>; domains: Set<string> }>();

  for (const playlists of assembled.playlistsByCourse.values()) {
    for (const playlist of playlists) {
      if (!playlist.lecturer) continue;
      const entry = stats.get(playlist.lecturer) ?? {
        count: 0,
        courses: new Set<string>(),
        domains: new Set<string>(),
      };
      entry.count += 1;
      entry.courses.add(playlist.courseId);
      for (const domain of coursesById.get(playlist.courseId)?.domains ?? []) {
        entry.domains.add(domain);
      }
      stats.set(playlist.lecturer, entry);
    }
  }

  const result: Record<string, BuiltLecturer> = {};
  for (const [name, entry] of stats) {
    result[name] = BuiltLecturerSchema.parse({
      name,
      playlistCount: entry.count,
      courseIds: [...entry.courses].sort(),
      domainIds: [...entry.domains].sort(),
    });
  }
  return result;
}

/* ────────────────────────────  Search index  ───────────────────────────── */

/** Keywords are normalised at build time so the client compares like with like. */
function keywordsOf(...sources: Array<Record<string, string[]>>) {
  return (key: string, ...extra: string[]): string[] => {
    const set = new Set<string>();
    for (const word of [...sources.flatMap((source) => source[key] ?? []), ...extra]) {
      const normalised = normalize(word);
      if (normalised) set.add(normalised);
    }
    return [...set];
  };
}

/**
 * The half of the index that is written in a language: courses and fields.
 *
 * Built once per interface language, from that language's own dictionary and
 * its own keyword file. Without this an English reader searching an English
 * page would be typing at a Russian index — every row a title they cannot read,
 * and nothing found for the words actually on their screen.
 */
function buildCatalogueEntries(
  dictionary: Record<string, string>,
  keywords: Array<Record<string, string[]>>,
  courses: BuiltCourse[],
  domains: BuiltDomain[],
  aliases: Record<string, string[]> = {}
): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const t = (key: string, fallback: string): string => dictionary[key] ?? fallback;
  const keywordsFor = keywordsOf(...keywords);

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
    const named = aliases[`course.${course.id}`] ?? [];
    entries.push({
      t: 'c',
      id: course.id,
      n: title,
      k: keywordsFor(`course.${course.id}`, title, course.id.replace(/-/g, ' ')),
      s: course.playlistCount,
      // Unnormalised, unlike `k`: this one is printed, not matched against.
      ...(named.length ? { a: named } : {}),
    });
  }

  return entries;
}

/**
 * The half nobody translates: playlists, channels and lecturers, named on
 * YouTube by whoever published them.
 */
function buildMaterialEntries(
  sources: Sources,
  providers: Record<string, BuiltProvider>,
  lecturers: Record<string, BuiltLecturer>,
  assembled: Assembled
): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const keywordsFor = keywordsOf(sources.keywords);

  for (const playlists of assembled.playlistsByCourse.values()) {
    for (const playlist of playlists) {
      entries.push({
        t: 'p',
        id: playlist.id,
        n: playlist.title,
        k: keywordsFor(`playlist.${playlist.id}`, playlist.title, playlist.channelTitle),
        // `s` is a tiebreaker worth a thousandth of a match in `shared/search.ts`,
        // so it has to stay small and positive. The rating is a z-score around
        // zero; this is the same 0..50 band the old score happened to occupy.
        s: Math.round(clamp((playlist.rating + 3) / 6, 0, 1) * 50),
        // Selecting a playlist has to open its course first, so the shard it
        // lives in must be known without loading every shard to find it.
        c: playlist.courseId,
      });
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

  for (const lecturer of Object.values(lecturers)) {
    entries.push({
      t: 'l',
      id: lecturer.name,
      n: lecturer.name,
      k: keywordsFor(`lecturer.${lecturer.name}`, lecturer.name),
      s: lecturer.playlistCount,
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
  reportRunError(error);
});
