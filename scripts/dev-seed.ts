import { openDb } from './lib/db.js';
import { loadSources, reportSourceError } from './lib/sources.js';
import { nowIso, parseLimit, reportRemaining } from './lib/config.js';

/**
 * DEVELOPMENT ONLY. Fills cache.db with synthetic playlists so the playlist
 * list, filters, sorting and the modal can be worked on without spending a day
 * of YouTube quota first.
 *
 * Everything it writes is deterministic and obviously fake — titles say so.
 * Never run this against a cache.db that holds real crawl results: it inserts
 * rows with `dev-` ids, and `--wipe` removes them again.
 *
 *   pnpm tsx scripts/dev-seed.ts          # add fake playlists
 *   pnpm tsx scripts/dev-seed.ts 20       # seed twenty more courses
 *   pnpm tsx scripts/dev-seed.ts --wipe   # remove them
 */

const DEV_PREFIX = 'dev-';

/** Deterministic PRNG so repeated runs produce the same catalogue. */
function seeded(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LECTURERS = [
  'Иванов А. А.', 'Петров С. М.', 'Райгородский А. М.', 'Савватеев А. В.',
  'Смирнова Е. К.', 'Gilbert Strang', 'David Malan', 'Ana Bell',
];

function main(): void {
  const wipe = process.argv.includes('--wipe');
  const limit = parseLimit();
  const sources = loadSources();
  const db = openDb();

  if (wipe) {
    const removed = db.prepare(`DELETE FROM playlists WHERE id LIKE ?`).run(`${DEV_PREFIX}%`).changes;
    db.prepare(`DELETE FROM videos WHERE playlist_id LIKE ?`).run(`${DEV_PREFIX}%`);
    db.prepare(`DELETE FROM matches WHERE playlist_id LIKE ?`).run(`${DEV_PREFIX}%`);
    db.prepare(`DELETE FROM channels WHERE id LIKE ?`).run(`${DEV_PREFIX}%`);
    console.log(`✓ removed ${removed} development playlists`);
    db.close();
    return;
  }

  const insertChannel = db.prepare(
    `INSERT OR REPLACE INTO channels (id, title, provider_id, handle, last_discovered_at)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertPlaylist = db.prepare(
    `INSERT OR REPLACE INTO playlists
       (id, channel_id, title, description, video_count, published_at, views, likes, comments,
        lang, captions, total_seconds, median_seconds, stats_fetched_at, videos_fetched_at,
        alive, checked_at, next_refresh_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );
  const insertVideo = db.prepare(
    `INSERT OR REPLACE INTO videos
       (id, playlist_id, position, title, duration_seconds, published_at, views, likes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertMatch = db.prepare(
    `INSERT OR REPLACE INTO matches (playlist_id, course_id, confidence, method, reviewed, updated_at)
     VALUES (?, ?, 1.0, 'manual', 1, ?)`
  );

  // Every channel from channels.yaml gets a development twin.
  for (const channel of sources.channels) {
    insertChannel.run(
      `${DEV_PREFIX}${channel.id}`,
      channel.title,
      channel.providerId,
      channel.id,
      nowIso()
    );
  }

  const now = nowIso();
  const seenCourse = db.prepare(`SELECT 1 FROM playlists WHERE id = ?`);
  let playlists = 0;
  let videos = 0;
  let courses = 0;
  let remaining = 0;

  const run = db.transaction(() => {
    for (const course of sources.courses) {
      // Seeding is per course, not per playlist: the generator is seeded once
      // per course, so stopping mid-course would shift every number after it
      // and the data would stop being reproducible.
      if (seenCourse.get(`${DEV_PREFIX}${course.id}-0`)) continue;
      if (courses >= limit) {
        remaining += 1;
        continue;
      }

      const rnd = seeded(`dev:${course.id}`);
      // Not every course gets material — an empty course is a normal state the
      // interface has to look right in.
      if (rnd() < 0.18) continue;

      courses += 1;
      const howMany = 1 + Math.floor(rnd() * 6);
      for (let i = 0; i < howMany; i++) {
        const channel = sources.channels[Math.floor(rnd() * sources.channels.length)];
        const playlistId = `${DEV_PREFIX}${course.id}-${i}`;
        const lang = channel.lang;
        const title = `${courseTitle(sources.i18n, course.id)} — ${channel.title} [dev]`;
        const videoCount = 4 + Math.floor(rnd() * 30);
        const median = 900 + Math.floor(rnd() * 7200);
        const year = 2013 + Math.floor(rnd() * 12);
        const views = Math.floor(200 + rnd() ** 3 * 3_000_000);
        const likes = Math.floor(views * (0.01 + rnd() * 0.05));
        const comments = Math.floor(likes * (0.02 + rnd() * 0.12));

        let total = 0;
        for (let v = 0; v < videoCount; v++) {
          const seconds = Math.max(240, Math.round(median * (0.7 + rnd() * 0.6)));
          total += seconds;
          insertVideo.run(
            `${playlistId}-v${v}`,
            playlistId,
            v,
            `Лекция ${v + 1}. ${courseTitle(sources.i18n, course.id)}`,
            seconds,
            `${year}-09-${String(1 + (v % 28)).padStart(2, '0')}T10:00:00Z`,
            Math.floor(views / videoCount),
            Math.floor(likes / videoCount)
          );
          videos += 1;
        }

        const captions = rnd() < 0.5 ? (lang === 'ru' ? 'ru' : 'en,ru') : '';
        insertPlaylist.run(
          playlistId,
          `${DEV_PREFIX}${channel.id}`,
          rnd() < 0.75 ? `${title} · курс лекций` : `${title} · семинары`,
          `Синтетические данные для разработки. Лектор: ${LECTURERS[Math.floor(rnd() * LECTURERS.length)]}`,
          videoCount,
          `${year}-09-01T10:00:00Z`,
          views,
          likes,
          comments,
          lang,
          captions,
          total,
          median,
          now,
          now,
          now,
          now
        );
        insertMatch.run(playlistId, course.id, now);
        playlists += 1;
      }
    }
  });
  run();

  console.log(
    `✓ seeded ${playlists} development playlists across ${courses} courses (${videos} videos). ` +
      `Run \`pnpm data:build\` next, and \`--wipe\` to undo.`
  );
  reportRemaining(remaining, limit);
  db.close();
}

function courseTitle(i18n: Record<string, string>, courseId: string): string {
  return i18n[`course.${courseId}.title`] ?? courseId;
}

try {
  main();
} catch (error) {
  reportSourceError(error);
}
