import { openDb } from './lib/db.js';
import { reportSourceError } from './lib/sources.js';
import { createClient } from './lib/youtube.js';
import { refreshPlaylistMetadata } from './lib/tasks.js';

/**
 * Refreshes playlist metadata in batches of 50 — one quota unit per batch.
 * Incremental by `next_refresh_at`, so repeated runs are nearly free.
 */
async function main(): Promise<void> {
  const db = openDb();
  const api = createClient(db);

  const { refreshed, quotaExhausted } = await refreshPlaylistMetadata(db, api);
  if (quotaExhausted) {
    console.log(`data:playlists: квота исчерпана, продолжу завтра (обновлено ${refreshed})`);
  } else {
    console.log(`✓ data:playlists: refreshed ${refreshed} playlists`);
  }
  console.log(`· quota spent today: ${api.spent()}`);
  db.close();
}

main().catch(reportSourceError);
