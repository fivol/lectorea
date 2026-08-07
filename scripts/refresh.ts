import { openDb } from './lib/db.js';
import { reportSourceError } from './lib/sources.js';
import { createClient } from './lib/youtube.js';
import { pendingCount, runWorker } from './lib/queue.js';
import { checkLiveness, fetchPlaylistVideos, refreshPlaylistMetadata } from './lib/tasks.js';

/**
 * The nightly job: metadata → videos → liveness, in that order, until the queue
 * drains or the quota does. Running out of quota is a normal end of the working
 * day, not a failure, so this exits 0 either way and CI stays green.
 */
async function main(): Promise<void> {
  const db = openDb();
  const api = createClient(db);
  const started = api.spent();

  const metadata = await refreshPlaylistMetadata(db, api);
  console.log(`· metadata: ${metadata.refreshed} refreshed`);

  let exhausted = metadata.quotaExhausted;

  if (!exhausted) {
    console.log(`· videos: ${pendingCount(db, ['videos'])} queued`);
    const videos = await runWorker(db, ['videos'], async (job) => {
      await fetchPlaylistVideos(db, api, job.target);
    });
    console.log(`· videos: ${videos.done} done, ${videos.failed} failed`);
    exhausted = videos.quotaExhausted;
  }

  if (!exhausted) {
    const liveness = await checkLiveness(db, api);
    console.log(`· liveness: ${liveness.checked} checked, ${liveness.dead} gone`);
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
