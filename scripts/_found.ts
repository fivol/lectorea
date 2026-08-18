/**
 * Scratch: the history `found_at` would have had, read back out of the bodies.
 *
 * `found_at` is written by the insert, so it only knows about rows inserted
 * after the column existed. Everything crawled before that has a null, and a
 * chart of "what did each day find" would start on the day the column was added
 * — with the whole catalogue looking like it appeared out of nothing.
 *
 * `raw_responses` still holds the answer. Every API body is kept verbatim with
 * the time it arrived, so the first body that mentions a playlist or a video is
 * the day the crawl found it, and that is a fact about what was paid for rather
 * than a guess. Three sources, cheapest first:
 *
 *   playlists     · the body of a channel scan names the playlists it found,
 *                   and the request key of a metadata call names the ones it
 *                   was asked about. 3735 rows, and the only pass that reads
 *                   bodies at all.
 *   playlistItems · the request key carries `playlistId` — the day a playlist
 *                   was walked, which is the best available answer for one that
 *                   arrived by id and was never part of a channel scan.
 *   videos        · the request key carries the fifty ids the call detailed.
 *
 * The last two never touch a row: `idx_raw_key` covers `(endpoint, request_key)`
 * and rowid comes with every index, so two hundred thousand keys are read
 * straight out of the index and the 18 GB of bodies beside them stays on disk.
 * `fetched_at` is not in that index, and reading it would mean pulling every
 * body it sits behind — hence the day boundaries below, binary-searched by
 * rowid, which is exact because the table is only ever appended to.
 *
 * Only nulls are filled: a stamp the crawl wrote is a first sighting observed
 * directly and outranks anything reconstructed here. An id no body accounts for
 * keeps its null, because "unknown" is the truth about it.
 *
 * What it writes is a day, at midnight UTC — the resolution the reconstruction
 * actually has, and the way to tell a reconstructed date from an observed one
 * later: the crawl's own stamps carry the time of day they happened at.
 *
 *   pnpm tsx scripts/_found.ts           # what it would stamp, day by day
 *   pnpm tsx scripts/_found.ts --apply   # write it
 *
 * Costs nothing: no network, no quota. Reads a lot of index, so give it a
 * minute — and run it when nothing else is writing to the cache.
 *
 * Run once per machine. It is worth nothing on a cache restored from the
 * release, which carries no raw bodies at all — there the stamps arrive with
 * the snapshot instead.
 *
 * And publish before pulling. `cache:restore` replaces these tables from the
 * release with whatever columns the two copies share, so a release published
 * before the column existed takes the whole reconstruction with it. `make
 * cache-push` first, and the next pull has nothing to overwrite.
 */
import { openDb } from './lib/db.js';

const apply = process.argv.includes('--apply');
const db = openDb();

type Row = { id: number; request_key: string; body?: string };

const span = db.prepare(`SELECT min(id) AS lo, max(id) AS hi FROM raw_responses`).get() as {
  lo: number | null;
  hi: number | null;
};

if (span.lo === null || span.hi === null) {
  console.log('· raw_responses is empty — nothing to reconstruct from.');
  console.log('  A cache restored from the release has no bodies; its stamps come with the snapshot.');
  db.close();
  process.exit(0);
}

/* ─────────────────────  Which day a raw row belongs to  ─────────────────── */

const atOrAfter = db.prepare(
  `SELECT id, fetched_at FROM raw_responses WHERE id >= ? ORDER BY id LIMIT 1`
);
const fetchedAt = (id: number): { id: number; fetched_at: string } | undefined =>
  atOrAfter.get(id) as { id: number; fetched_at: string } | undefined;

/** The lowest rowid whose body arrived on `day` or later. */
function firstIdOfDay(day: string): number | null {
  let lo = span.lo as number;
  let hi = span.hi as number;
  let answer: number | null = null;
  while (lo <= hi) {
    const row = fetchedAt(Math.floor((lo + hi) / 2));
    if (!row) break;
    if (row.fetched_at.slice(0, 10) >= day) {
      answer = row.id;
      hi = row.id - 1;
    } else {
      lo = row.id + 1;
    }
  }
  return answer;
}

const firstDay = (fetchedAt(span.lo) as { fetched_at: string }).fetched_at.slice(0, 10);
const lastDay = (
  db.prepare(`SELECT fetched_at FROM raw_responses ORDER BY id DESC LIMIT 1`).get() as {
    fetched_at: string;
  }
).fetched_at.slice(0, 10);

const boundaries: Array<{ startId: number; day: string }> = [];
for (let at = Date.parse(`${firstDay}T00:00:00Z`); ; at += 86_400_000) {
  const day = new Date(at).toISOString().slice(0, 10);
  const startId = boundaries.length ? firstIdOfDay(day) : (span.lo as number);
  if (startId !== null) boundaries.push({ startId, day });
  if (day >= lastDay) break;
}

/** The day a rowid was fetched on. Exact: rowids are handed out in time order. */
function dayOf(id: number): string {
  let index = boundaries.length - 1;
  while (index > 0 && boundaries[index].startId > id) index -= 1;
  return boundaries[index].day;
}

console.log(
  `· ${boundaries.length} days of bodies, ${firstDay} … ${lastDay}, rowids ${span.lo}–${span.hi}`
);

/* ────────────────────────────  The first sighting  ─────────────────────── */

const playlistDay = new Map<string, string>();
const videoDay = new Map<string, string>();

function note(into: Map<string, string>, id: string, day: string): void {
  const seen = into.get(id);
  // The passes run one endpoint at a time rather than in one pass over the
  // table, so an id can be met out of order — the earliest sighting wins, not
  // the first one this script happens to reach.
  if (!seen || day < seen) into.set(id, day);
}

/** The comma-separated `id` parameter of a batch call, if the call had one. */
function idsInKey(key: string): string[] {
  const params = JSON.parse(key) as { id?: string };
  return params.id ? params.id.split(',').filter(Boolean) : [];
}

let bodies = 0;
for (const row of db
  .prepare(`SELECT id, request_key, body FROM raw_responses WHERE endpoint = 'playlists' ORDER BY id`)
  .iterate() as Iterable<Required<Row>>) {
  const day = dayOf(row.id);
  bodies += 1;
  for (const id of idsInKey(row.request_key)) note(playlistDay, id, day);
  const items = (JSON.parse(row.body) as { items?: Array<{ id?: string }> }).items ?? [];
  for (const item of items) if (item.id) note(playlistDay, item.id, day);
}
console.log(`· ${bodies} channel scans and metadata calls → ${playlistDay.size} playlists`);

let walks = 0;
for (const row of db
  .prepare(`SELECT id, request_key FROM raw_responses WHERE endpoint = 'playlistItems' ORDER BY id`)
  .iterate() as Iterable<Row>) {
  walks += 1;
  const params = JSON.parse(row.request_key) as { playlistId?: string };
  if (params.playlistId) note(playlistDay, params.playlistId, dayOf(row.id));
}
console.log(`· ${walks} walks → ${playlistDay.size} playlists in all`);

let details = 0;
for (const row of db
  .prepare(`SELECT id, request_key FROM raw_responses WHERE endpoint = 'videos' ORDER BY id`)
  .iterate() as Iterable<Row>) {
  details += 1;
  const day = dayOf(row.id);
  for (const id of idsInKey(row.request_key)) note(videoDay, id, day);
}
console.log(`· ${details} detail calls → ${videoDay.size} videos`);

/* ───────────────────────  What that is worth to the tables  ─────────────── */

type Plan = { day: string; rows: number };

function planFor(table: 'playlists' | 'videos', days: Map<string, string>): Plan[] {
  const unstamped = db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND found_at IS NULL`);
  const byDay = new Map<string, number>();
  for (const [id, day] of days) {
    if (!unstamped.get(id)) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay].sort().map(([day, rows]) => ({ day, rows }));
}

const plans = {
  playlists: planFor('playlists', playlistDay),
  videos: planFor('videos', videoDay),
};

const total = (plan: Plan[]): number => plan.reduce((sum, row) => sum + row.rows, 0);
const missing = (table: string): number =>
  (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE found_at IS NULL`).get() as { n: number }
  ).n;

console.log('\n  день          плейлистов      видео');
const everyDay = [...new Set([...plans.playlists, ...plans.videos].map((row) => row.day))].sort();
for (const day of everyDay) {
  const playlists = plans.playlists.find((row) => row.day === day)?.rows ?? 0;
  const videos = plans.videos.find((row) => row.day === day)?.rows ?? 0;
  console.log(
    `  ${day}  ${String(playlists).padStart(11)}  ${String(videos).padStart(9)}`
  );
}

const left = {
  playlists: missing('playlists') - total(plans.playlists),
  videos: missing('videos') - total(plans.videos),
};
console.log(
  `\n· ${total(plans.playlists)} playlists and ${total(plans.videos)} videos can be dated; ` +
    `${left.playlists} and ${left.videos} stay unknown`
);

if (!apply) {
  console.log('\n· nothing written — pass --apply to stamp them');
  db.close();
  process.exit(0);
}

for (const [table, days] of [
  ['playlists', playlistDay],
  ['videos', videoDay],
] as const) {
  const stamp = db.prepare(`UPDATE ${table} SET found_at = ? WHERE id = ? AND found_at IS NULL`);
  let written = 0;
  db.transaction(() => {
    for (const [id, day] of days) written += stamp.run(`${day}T00:00:00.000Z`, id).changes;
  })();
  console.log(`✓ ${written} ${table} stamped`);
}

console.log('· the stamps travel with the cache: make cache-push, or make publish');
db.close();
