import { parseLimit, reportRemaining } from './lib/config.js';
import { openDb } from './lib/db.js';
import { reportSourceError } from './lib/sources.js';
import { createClient } from './lib/youtube.js';
import { checkLiveness } from './lib/tasks.js';

/**
 * Marks playlists that disappeared or went private. Batched 50 per unit;
 * a dead playlist is never retried — 404 and 403 here are permanent.
 *
 * `pnpm data:liveness 500` checks five hundred and leaves the rest due.
 */
async function main(): Promise<void> {
  const limit = parseLimit();
  const db = openDb();
  const api = createClient(db);

  const { checked, dead, quotaExhausted, remaining } = await checkLiveness(db, api, limit);
  if (quotaExhausted) {
    console.log(`data:liveness: квота исчерпана, продолжу завтра (проверено ${checked})`);
  } else {
    console.log(`✓ data:liveness: checked ${checked}, ${dead} gone`);
  }
  reportRemaining(remaining, limit);
  console.log(`· quota spent today: ${api.spent()}`);
  db.close();
}

main().catch(reportSourceError);
