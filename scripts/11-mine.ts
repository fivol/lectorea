import { parseLimit, reportRemaining } from './lib/config.js';
import { MINED_THROUGH, openDb, setMeta } from './lib/db.js';
import { PLAYLIST_ID_IN_TEXT } from './lib/playlist-id.js';
import { queuePlaylists } from './lib/queue.js';
import { reportRunError } from './lib/exit.js';

/**
 * Mines the crawl for playlists the crawl itself paid for and never noticed.
 *
 * Lecturers link their own courses: "full playlist here", "part 2 of the
 * series", "prerequisites in my linear algebra course". Those links sit in
 * video and playlist descriptions, and `raw_responses` keeps the API bodies — so
 * they are already on disk. This costs **no quota and no network**: it is a
 * regex over a table.
 *
 * It is also what makes those bodies disposable. A description nobody has mined
 * is the only copy of the playlists it links to, so this run stamps
 * `meta.mined_through` and `cache:prune` refuses to expire anything newer.
 *
 * Worth re-running after every crawl. Each newly walked playlist arrives with
 * the descriptions of its videos attached, so the seam refills itself; see
 * docs/harvest.md.
 */

/** Which prefixes and lengths count, and why: lib/playlist-id.ts. */
const PLAYLIST_ID = PLAYLIST_ID_IN_TEXT;

function main(): void {
  const limit = parseLimit();
  const db = openDb();

  // Stamped from before the scan, not after: everything already on disk is
  // about to be read, and a body that arrives mid-run has not been. This is
  // what lets `cache:prune` expire a body — see MINED_THROUGH.
  const scanningFrom = new Date().toISOString();

  const known = new Set(
    (db.prepare(`SELECT id FROM playlists`).all() as Array<{ id: string }>).map((row) => row.id)
  );

  /** id → where it was seen, for the report and for nothing else. */
  const found = new Map<string, string>();

  const scan = (text: string | null, origin: string): void => {
    if (!text) return;
    for (const match of text.matchAll(PLAYLIST_ID)) {
      const id = match[1];
      if (known.has(id) || found.has(id)) continue;
      found.set(id, origin);
    }
  };

  // `LIKE` first so the scan reads the few thousand bodies that can possibly
  // match rather than every response ever stored.
  for (const row of db
    .prepare(`SELECT endpoint, body FROM raw_responses WHERE body LIKE '%list=%'`)
    .iterate() as Iterable<{ endpoint: string; body: string }>)
    scan(row.body, row.endpoint);

  for (const row of db
    .prepare(`SELECT description FROM playlists WHERE description LIKE '%list=%'`)
    .iterate() as Iterable<{ description: string }>)
    scan(row.description, 'playlist description');

  if (!found.size) {
    setMeta(db, MINED_THROUGH, scanningFrom);
    console.log('✓ data:mine: nothing new in what is already stored');
    db.close();
    return;
  }

  const byOrigin = new Map<string, number>();
  for (const origin of found.values()) byOrigin.set(origin, (byOrigin.get(origin) ?? 0) + 1);
  for (const [origin, count] of [...byOrigin].sort((a, b) => b[1] - a[1]))
    console.log(`· ${origin}: ${count}`);

  const { added, skipped, rejected } = queuePlaylists(
    db,
    [...found.keys()].map((id) => ({ id })),
    'mined',
    limit
  );

  setMeta(db, MINED_THROUGH, scanningFrom);
  db.close();
  console.log(`✓ data:mine: ${added} new playlists queued, ${found.size} found`);
  if (rejected) console.log(`· ${rejected} refused as malformed ids`);
  reportRemaining(skipped, limit);
  console.log('· run `pnpm data:refresh` to fetch them, then `pnpm data:match`');
}

try {
  main();
} catch (error) {
  reportRunError(error);
}
