import { parseLimit, reportRemaining } from './lib/config.js';
import { openDb } from './lib/db.js';
import { reportSourceError } from './lib/sources.js';
import { createClient } from './lib/youtube.js';
import { refreshPlaylistMetadata } from './lib/tasks.js';

/**
 * Refreshes playlist metadata in batches of 50 — one quota unit per batch.
 * Incremental by `next_refresh_at`, so repeated runs are nearly free.
 *
 * `pnpm data:playlists 100` refreshes a hundred and leaves the rest due.
 */
async function main(): Promise<void> {
  const limit = parseLimit();
  const db = openDb();
  const api = createClient(db);

  const { refreshed, quotaExhausted, remaining } = await refreshPlaylistMetadata(db, api, limit);
  if (quotaExhausted) {
    console.log(`data:playlists: квота исчерпана, продолжу завтра (обновлено ${refreshed})`);
  } else {
    console.log(`✓ data:playlists: refreshed ${refreshed} playlists`);
  }
  reportRemaining(remaining, limit);
  console.log(`· quota spent today: ${api.spent()}`);
  db.close();
}

main().catch(reportSourceError);
