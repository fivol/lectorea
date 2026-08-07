import { openDb } from './lib/db.js';
import { reportSourceError } from './lib/sources.js';
import { createClient } from './lib/youtube.js';
import { checkLiveness } from './lib/tasks.js';

/**
 * Marks playlists that disappeared or went private. Batched 50 per unit;
 * a dead playlist is never retried — 404 and 403 here are permanent.
 */
async function main(): Promise<void> {
  const db = openDb();
  const api = createClient(db);

  const { checked, dead, quotaExhausted } = await checkLiveness(db, api);
  if (quotaExhausted) {
    console.log(`data:liveness: квота исчерпана, продолжу завтра (проверено ${checked})`);
  } else {
    console.log(`✓ data:liveness: checked ${checked}, ${dead} gone`);
  }
  console.log(`· quota spent today: ${api.spent()}`);
  db.close();
}

main().catch(reportSourceError);
