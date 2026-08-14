import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { env, paths } from './lib/config.js';
import { openDb } from './lib/db.js';
import { isPlaylistId } from './lib/playlist-id.js';
import { loadCourseFiles, reportSourceError, SourceError } from './lib/sources.js';
import { seedManualMatches } from './lib/tasks.js';
import { createClient, QuotaExceededError } from './lib/youtube.js';

/**
 * Binds one playlist to one course, by link.
 *
 *   pnpm playlist:add https://youtube.com/playlist?list=PL… --course=probability
 *   pnpm playlist:add PL…                                   # look, do not touch
 *
 * `data:review` is the tool for going through a queue of candidates; this one
 * is for the single playlist that arrived from outside it — an issue with a
 * link in it, a recommendation, something spotted by hand. It does the two
 * things that binding actually takes and that are easy to do only half of:
 * writes the match into `overrides.yaml`, which is the committed record, and
 * puts the playlist into the crawl queue, without which the match points at a
 * row that does not exist and the build quietly ignores it.
 *
 * Without `--course` it only looks the playlist up and prints what it is, at a
 * cost of one quota unit — which is the check worth doing before believing a
 * link from a stranger.
 */

type Args = { playlistId: string; courseId?: string };

/**
 * Both the share link and the watch-page URL carry the id in `list=`.
 *
 * What comes back is a *well-formed* id or nothing: a hand-pasted link is
 * exactly where a half-copied id comes from, and lib/playlist-id.ts is the
 * record of what an id loosely accepted here goes on to cost downstream.
 */
export function playlistIdFrom(input: string): string | undefined {
  const trimmed = input.trim();
  const candidate = trimmed.includes('/')
    ? /[?&]list=([A-Za-z0-9_-]+)/.exec(trimmed)?.[1]
    : trimmed;
  return candidate && isPlaylistId(candidate) ? candidate : undefined;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((argument) => !argument.startsWith('--'));
  const courseId = argv
    .find((argument) => argument.startsWith('--course='))
    ?.slice('--course='.length)
    .trim();

  const input = positional[0];
  if (!input) {
    throw new SourceError('Usage: pnpm playlist:add <url|id> [--course=<course id>]');
  }

  const playlistId = playlistIdFrom(input);
  if (!playlistId) {
    throw new SourceError(`No playlist id in "${input}"`, [
      'A video link is not a playlist link — the id is the `list=` parameter,',
      'and a `watch?v=…` without one points at one video out of the course.',
      'An id that looks right but is refused is usually a half-copied one:',
      '`PL` followed by 32 characters, 16 hex digits, or a video id.',
    ]);
  }

  return { playlistId, courseId: courseId || undefined };
}

/**
 * Writes `matches: <playlist>: <course>` into overrides.yaml through the YAML
 * document rather than the parsed object, so the file keeps the comments that
 * explain what each section is for.
 */
function writeMatch(playlistId: string, courseId: string): void {
  const file = path.join(paths.data, 'overrides.yaml');
  const document = parseDocument(fs.readFileSync(file, 'utf8'));
  document.setIn(['matches', playlistId], courseId);
  fs.writeFileSync(file, document.toString(), 'utf8');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = openDb();

  try {
    const { courses } = loadCourseFiles();
    if (args.courseId && !courses.some((course) => course.id === args.courseId)) {
      throw new SourceError(`Unknown course "${args.courseId}"`, [
        'Create it first with `pnpm course:new`, or leave --course off to just look.',
      ]);
    }

    const known = db
      .prepare(`SELECT title, channel_id, video_count, alive FROM playlists WHERE id = ?`)
      .get(args.playlistId) as
      | { title: string | null; channel_id: string | null; video_count: number | null; alive: number }
      | undefined;

    // One unit, and the only way to know the link is a real playlist rather
    // than a typo or something deleted last year. Out of quota is not a reason
    // to refuse the decision: the crawl checks the id again before it publishes
    // anything, and a binding nobody can write down today is a binding lost.
    if (env.youtubeKeys.length === 0) {
      console.warn('! YOUTUBE_API_KEY is not set — the link is taken on trust');
    } else {
      const api = createClient(db);
      try {
        const [item] = await api.playlists([args.playlistId]);
        if (!item) {
          throw new SourceError(`YouTube does not know playlist ${args.playlistId}`, [
            'Private, deleted, or the id was mistyped.',
          ]);
        }
        console.log(`· ${item.snippet.title}`);
        console.log(`  ${item.snippet.channelTitle} · ${item.contentDetails.itemCount} videos`);
      } catch (error) {
        if (!(error instanceof QuotaExceededError)) throw error;
        console.warn('! quota is out for today — the link is taken on trust');
      }
    }

    if (known) {
      console.log(
        `· already in the cache: ${known.video_count ?? 0} videos` +
          (known.alive ? '' : ', marked gone')
      );
    }

    if (!args.courseId) {
      console.log('\nAdd --course=<id> to bind it.');
      return;
    }

    writeMatch(args.playlistId, args.courseId);
    const seeded = seedManualMatches(db, { [args.playlistId]: args.courseId });

    console.log(`\n✓ ${args.playlistId} → ${args.courseId}`);
    console.log('  data/overrides.yaml updated');
    console.log(
      seeded
        ? '  queued for the crawl — run `pnpm data:refresh` to fetch it, then `pnpm data:build`'
        : '  already crawled — run `pnpm data:build`'
    );
  } finally {
    db.close();
  }
}

main().catch(reportSourceError);
