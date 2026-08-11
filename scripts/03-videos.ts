import { parseLimit, reportRemaining } from './lib/config.js';
import { openDb } from './lib/db.js';
import { reportSourceError } from './lib/sources.js';
import { createClient } from './lib/youtube.js';
import { pendingCount, reportWorker, runWorker } from './lib/queue.js';
import { fetchPlaylistVideos } from './lib/tasks.js';

/**
 * Walks queued playlists and stores their videos, then rolls durations and
 * statistics up onto the playlist. This is the expensive step: one unit per 50
 * videos listed plus one per 50 videos detailed.
 *
 * Also the step where the limit earns its keep: `pnpm data:videos 20` spends a
 * predictable slice of the quota, and the queue keeps the rest for next time.
 */
async function main(): Promise<void> {
  const limit = parseLimit();
  const db = openDb();
  const api = createClient(db);

  const pending = pendingCount(db, ['videos']);
  console.log(`· ${pending} playlists queued for video fetch`);

  let processed = 0;
  const result = await runWorker(
    db,
    ['videos'],
    async (job) => {
      const count = await fetchPlaylistVideos(db, api, job.target);
      processed += 1;
      if (processed % 25 === 0) {
        console.log(`  ${processed} playlists · last ${count} videos · quota ${api.spent()}`);
      }
    },
    limit
  );

  reportWorker('data:videos', result);
  reportRemaining(pendingCount(db, ['videos']), limit);
  console.log(`· quota spent today: ${api.spent()}`);
  db.close();
}

main().catch(reportSourceError);
