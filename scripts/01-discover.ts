import { parseLimit, reportRemaining } from './lib/config.js';
import { openDb } from './lib/db.js';
import { loadSources, reportSourceError } from './lib/sources.js';
import { createClient } from './lib/youtube.js';
import { pendingCount, reportWorker, runWorker } from './lib/queue.js';
import { discoverChannel, queueDiscovery } from './lib/tasks.js';

/**
 * Channels → playlists. Run after editing data/channels.yaml, roughly monthly.
 * Costs 1 unit per channel plus 1 per 50 playlists it owns.
 *
 * `pnpm data:discover 3` crawls three channels; the rest stay queued and the
 * next call takes the three after them.
 */
async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const limit = parseLimit();
  const sources = loadSources();
  const db = openDb();
  const api = createClient(db);

  // Queueing is free — it is a row per channel — so the whole backlog is put in
  // the queue and the limit is applied to the crawling, which is what costs.
  const queued = queueDiscovery(db, sources.channels, force);
  console.log(`· ${queued} of ${sources.channels.length} channels due for discovery`);

  const seeds = new Map(sources.channels.map((channel) => [channel.id, channel]));
  const result = await runWorker(
    db,
    ['discover'],
    async (job) => {
      const seed = seeds.get(job.target);
      if (!seed) return;
      const found = await discoverChannel(db, api, seed);
      console.log(`  ${seed.title}: ${found} playlists`);
    },
    limit
  );

  reportWorker('data:discover', result);
  reportRemaining(pendingCount(db, ['discover']), limit);
  console.log(`· quota spent today: ${api.spent()}`);
  db.close();
}

main().catch(reportSourceError);
