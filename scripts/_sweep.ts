/**
 * Scratch: the two kinds of row a crawl leaves behind that nothing else clears.
 *
 * Both are the residue of a rule that arrived after the data did. The door in
 * `lib/playlist-id.ts` refuses an id that cannot be one — but only for ids
 * arriving after it was written, and the rows scraped before it sat on disk
 * earning a `400 Invalid Value` on every retry. The metadata pass now leaves an
 * untitled playlist due — but the rows the video pass had already pushed a
 * month out stayed pushed, and a playlist with no title is one nothing can
 * classify, so it waits in the review queue for a title nobody will buy.
 *
 *   pnpm tsx scripts/_sweep.ts          # what it would do
 *   pnpm tsx scripts/_sweep.ts --write  # do it
 *
 * Costs nothing: no network, no quota.
 */
import { nowIso } from './lib/config.js';
import { openDb } from './lib/db.js';
import { isPlaylistId } from './lib/playlist-id.js';

const write = process.argv.includes('--write');
const db = openDb();

const untitled = db
  .prepare(
    `SELECT COUNT(*) AS n FROM playlists
     WHERE alive = 1 AND (title IS NULL OR title = '') AND next_refresh_at > ?`
  )
  .get(nowIso()) as { n: number };

const impossible = (db.prepare(`SELECT id FROM playlists`).all() as Array<{ id: string }>)
  .map((row) => row.id)
  .filter((id) => !isPlaylistId(id));

console.log(`· ${untitled.n} untitled playlists are not due for metadata until later`);
console.log(`· ${impossible.length} rows carry an id that cannot be a playlist id`);

if (!write) {
  console.log('\n· nothing written — pass --write to sweep');
  db.close();
  process.exit(0);
}

const madeDue = db
  .prepare(
    `UPDATE playlists SET next_refresh_at = ?
     WHERE alive = 1 AND (title IS NULL OR title = '')`
  )
  .run(nowIso()).changes;

const statements = [
  db.prepare(`DELETE FROM videos WHERE playlist_id = ?`),
  db.prepare(`DELETE FROM matches WHERE playlist_id = ?`),
  db.prepare(`DELETE FROM jobs WHERE target = ?`),
  db.prepare(`DELETE FROM playlists WHERE id = ?`),
];
db.transaction(() => {
  for (const id of impossible) for (const statement of statements) statement.run(id);
})();

console.log(`\n✓ ${madeDue} untitled playlists are due again — the next refresh buys their titles`);
console.log(`✓ ${impossible.length} impossible ids removed, with their jobs and matches`);
db.close();
