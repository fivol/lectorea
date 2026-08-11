import { parseLimit } from './lib/config.js';
import { openDb } from './lib/db.js';
import { loadSources, reportSourceError } from './lib/sources.js';
import { createClient } from './lib/youtube.js';
import { pendingCount, rankTargets, runWorker } from './lib/queue.js';
import {
  checkLiveness,
  fetchPlaylistVideos,
  refreshPlaylistMetadata,
  videoQueueTiers,
} from './lib/tasks.js';

/**
 * The nightly job: metadata → videos → liveness, in that order, until the queue
 * drains or the quota does. Running out of quota is a normal end of the working
 * day, not a failure, so this exits 0 either way and CI stays green.
 *
 * `pnpm data:refresh 10` caps each of the three stages at ten items — a way to
 * see what a crawl does to the quota before letting it run to the ceiling.
 */
async function main(): Promise<void> {
  const limit = parseLimit();
  const db = openDb();
  const api = createClient(db);
  const started = api.spent();

  const metadata = await refreshPlaylistMetadata(db, api, limit);
  console.log(`· metadata: ${metadata.refreshed} refreshed, ${metadata.remaining} left`);

  let exhausted = metadata.quotaExhausted;

  if (!exhausted) {
    console.log(`· videos: ${pendingCount(db, ['videos'])} queued`);
    rankTargets(db, videoQueueTiers(db, loadSources().overrides.matches));
    const videos = await runWorker(
      db,
      ['videos'],
      async (job) => {
        await fetchPlaylistVideos(db, api, job.target);
      },
      limit,
      'matched-first'
    );
    console.log(
      `· videos: ${videos.done} done, ${videos.failed} failed, ` +
        `${pendingCount(db, ['videos'])} left`
    );
    exhausted = videos.quotaExhausted;
  }

  if (!exhausted) {
    const liveness = await checkLiveness(db, api, limit);
    console.log(
      `· liveness: ${liveness.checked} checked, ${liveness.dead} gone, ${liveness.remaining} left`
    );
    exhausted = liveness.quotaExhausted;
  }

  console.log(
    exhausted
      ? `data:refresh: квота исчерпана, продолжу завтра (потрачено ${api.spent() - started} units)`
      : `✓ data:refresh: done, spent ${api.spent() - started} units`
  );
  db.close();
}

main().catch(reportSourceError);
