import { parseLimit, reportRemaining } from './lib/config.js';
import { openDb, type Db } from './lib/db.js';
import { loadSources } from './lib/sources.js';
import { reportRunError } from './lib/exit.js';
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
      // A channel being vetted is new information about every playlist already
      // mined off it. `05-match.ts` records `unclaimed` for a title that names
      // no course of this catalogue, and the usual reason such a title is worth
      // a second look is that somebody has now vouched for where it came from.
      // Lifting here means adding a line to channels.yaml reaches that
      // material, and not only the playlists discovery is about to find.
      const lifted = liftUnvettedRefusals(db, seed.id);
      console.log(`  ${seed.title}: ${found} playlists${lifted ? `, ${lifted} refusals lifted` : ''}`);
    },
    limit
  );

  reportWorker('data:discover', result);
  reportRemaining(pendingCount(db, ['discover']), limit);
  console.log(`· quota spent today: ${api.spent()}`);
  db.close();
}

/**
 * Playlists of this channel that no course of the catalogue claimed, put back
 * in front of the next `data:match`. A hand decision is never touched.
 */
function liftUnvettedRefusals(db: Db, channelSeedId: string): number {
  return db
    .prepare(
      `UPDATE matches SET refused = 0
       WHERE reviewed = 0 AND refused = 1 AND method = 'unclaimed'
         AND playlist_id IN (
           SELECT p.id FROM playlists p
           JOIN channels c ON c.id = p.channel_id
           WHERE lower(c.id) = lower(?) OR lower(c.handle) = lower(?)
         )`
    )
    .run(channelSeedId, channelSeedId).changes;
}

main().catch(reportRunError);
