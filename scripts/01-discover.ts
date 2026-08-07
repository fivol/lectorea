import { openDb } from './lib/db.js';
import { loadSources, reportSourceError } from './lib/sources.js';
import { createClient } from './lib/youtube.js';
import { reportWorker, runWorker } from './lib/queue.js';
import { discoverChannel, queueDiscovery } from './lib/tasks.js';

/**
 * Channels → playlists. Run after editing data/channels.yaml, roughly monthly.
 * Costs 1 unit per channel plus 1 per 50 playlists it owns.
 */
async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const sources = loadSources();
  const db = openDb();
  const api = createClient(db);

  const queued = queueDiscovery(db, sources.channels, force);
  console.log(`· ${queued} of ${sources.channels.length} channels due for discovery`);

  const seeds = new Map(sources.channels.map((channel) => [channel.id, channel]));
  const result = await runWorker(db, ['discover'], async (job) => {
    const seed = seeds.get(job.target);
    if (!seed) return;
    const found = await discoverChannel(db, api, seed);
    console.log(`  ${seed.title}: ${found} playlists`);
  });

  reportWorker('data:discover', result);
  console.log(`· quota spent today: ${api.spent()}`);
  db.close();
}

main().catch(reportSourceError);
