import { nowIso } from './lib/config.js';
import { openDb } from './lib/db.js';
import { reportRunError } from './lib/exit.js';
import { createClient } from './lib/youtube.js';

/**
 * Subscriber counts for every channel the catalogue shows.
 *
 * The rating uses them as the size of the room a playlist was played in: four
 * thousand views on a channel of ten thousand is a full house, and the same
 * four thousand on a channel of two million is nobody. Without this the
 * catalogue can only measure loudness.
 *
 * Cheap by design — `channels.list` is one unit per call whatever `part` asks
 * for, and it takes fifty ids at a time, so the whole catalogue costs single
 * digits. `pnpm data:subscribers` refreshes everything older than 30 days.
 */

const REFRESH_DAYS = 30;

async function main(): Promise<void> {
  const db = openDb();
  const api = createClient(db);

  const cutoff = new Date(Date.now() - REFRESH_DAYS * 864e5).toISOString();
  const rows = db
    .prepare(
      `SELECT DISTINCT c.id FROM channels c
       JOIN playlists p ON p.channel_id = c.id AND p.alive = 1
       WHERE c.stats_fetched_at IS NULL OR c.stats_fetched_at < ?`
    )
    .all(cutoff) as Array<{ id: string }>;

  if (!rows.length) {
    console.log('✓ data:subscribers: everything is fresh');
    db.close();
    return;
  }

  const stats = await api.channelStats(rows.map((row) => row.id));
  const update = db.prepare(
    `UPDATE channels SET subscribers = ?, subscribers_hidden = ?, stats_fetched_at = ? WHERE id = ?`
  );
  const write = db.transaction(() => {
    for (const item of stats) {
      update.run(item.hidden ? null : item.subscribers, item.hidden ? 1 : 0, nowIso(), item.id);
    }
  });
  write();

  const hidden = stats.filter((item) => item.hidden).length;
  console.log(
    `✓ data:subscribers: ${stats.length} channels of ${rows.length} due` +
      (hidden ? `, ${hidden} hide the count` : '')
  );
  console.log(`· quota spent today: ${api.spent()}`);
  db.close();
}

main().catch(reportRunError);
