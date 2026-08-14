import { parseLimit, reportRemaining } from './lib/config.js';
import { isBindingConfident, openDb, type MatchRow } from './lib/db.js';
import { loadSources } from './lib/sources.js';
import { reportRunError } from './lib/exit.js';
import { checkListPlayable } from './lib/tasks.js';

/**
 * Which playlists the embedded player refuses to open as `list=`.
 *
 * The Data API is not asked, because on this question it answers wrongly:
 * `privacyStatus: "public"` for playlists the player then meets with «This
 * video is unavailable». oEmbed refuses exactly the same ones and costs no
 * quota, so that is what this asks — see `checkListPlayable`.
 *
 * Only playlists a reader can reach are checked: the answer is published in the
 * shard, and nothing else is published at all.
 *
 *   pnpm data:embeds        # everything due
 *   pnpm data:embeds 200    # two hundred, and the rest stays due
 */
async function main(): Promise<void> {
  const limit = parseLimit();
  const db = openDb();
  const sources = loadSources();

  const published = new Set<string>();
  for (const row of db.prepare(`SELECT * FROM matches`).all() as MatchRow[]) {
    if (row.course_id && isBindingConfident(row)) published.add(row.playlist_id);
  }
  // A hand binding outranks the passes in the build, so it does here too — in
  // both directions: `null` means «not a course» and is not published.
  for (const [playlistId, courseId] of Object.entries(sources.overrides.matches)) {
    if (courseId) published.add(playlistId);
    else published.delete(playlistId);
  }

  const { checked, refused, remaining } = await checkListPlayable(db, published, limit);
  console.log(`✓ data:embeds: checked ${checked} of ${published.size} published, ${refused} refused`);
  reportRemaining(remaining, limit);
  db.close();
}

main().catch(reportRunError);
