/**
 * Scratch: who actually made the videos under the bindings already published?
 *
 * `_hunt.ts` asks this of *candidates* and refuses 73% of them — 231 collections
 * and 68 mirrors out of 316 probes on 2026-08-16. But the ownership test was
 * written for the hunt, and the catalogue is older than the hunt: every binding
 * made before it exists was decided on a title alone, which is exactly the
 * thing that cannot see a bag of bookmarks. «Linguistics», 268 videos, collected
 * from forty channels, reads as a course to every rule in `lib/rules.ts`.
 *
 * So this is the same one-unit question turned around and pointed at what is
 * live: not "should this be crawled" but **"is what the catalogue is already
 * showing a course at all"**.
 *
 *   pnpm tsx scripts/_authors.ts out.json [--min=40] [--apply]
 *
 * The filters run in rising order of price, the way docs/agents/practices.md
 * asks: a binding a human already settled is skipped for free, a binding on a
 * vetted channel is skipped for free — the channel earned its line by owning
 * its material — and only what is left is worth a unit.
 *
 * Nothing is written without `--apply`, and what it writes is `overrides.yaml`
 * rather than the `matches` table: a collection is a *decision*, it is the same
 * decision next month, and docs/agents/data-traps.md is emphatic that the
 * committed file is the record while the table is only the latest guess.
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './lib/config.js';
import { openDb } from './lib/db.js';
import { loadSources } from './lib/sources.js';
import { createClient, QuotaExceededError, TransientError } from './lib/youtube.js';

/** Below this a wrong binding is one card in a list; above it, it is the course. */
const MIN_VIDEOS = 40;

/** The channel made most of what it listed. Same number `_hunt.ts` judges on. */
const OWN_SHARE = 0.6;

/** One outside channel made almost all of it: a mirror, not a collection. */
const MIRROR_SHARE = 0.5;

type Row = {
  id: string;
  title: string;
  videos: number;
  channelId: string;
  courseId: string;
  confidence: number;
};

type Verdict = Row & {
  sampled: number;
  ownShare: number;
  kind: 'own' | 'mirror' | 'collection';
  realOwner?: { id: string; title: string; share: number };
};

const args = process.argv.slice(2);
const output = args.find((a) => !a.startsWith('--'));
const apply = args.includes('--apply');
const minVideos = Number(args.find((a) => a.startsWith('--min='))?.slice(6) ?? MIN_VIDEOS);

const db = openDb();
const sources = loadSources();
const api = createClient(db);

/*
 * A channel is vetted under either name it can have here: `channels.yaml` is
 * written in handles because a handle is readable, and the API answers `UC…`.
 * Comparing the two sets directly is the mistake docs/agents/pitfalls.md
 * records — it once reported YaleCourses as uncrawled.
 */
const configured = new Set(
  sources.channels.map((c) => c.id.toLowerCase().replace(/^@/, ''))
);
const vetted = new Set<string>();
for (const row of db.prepare(`SELECT id, handle FROM channels`).all() as Array<{
  id: string;
  handle: string | null;
}>) {
  const handle = row.handle ? row.handle.toLowerCase().replace(/^@/, '') : null;
  if (configured.has(row.id.toLowerCase()) || (handle && configured.has(handle))) {
    vetted.add(row.id);
  }
}

// Free filter 1: a human already decided this one, and outranks every pass.
const settled = new Set(Object.keys(sources.overrides.matches));

const all = db
  .prepare(
    `SELECT p.id, p.title, p.video_count AS videos, p.channel_id AS channelId,
            m.course_id AS courseId, m.confidence
       FROM playlists p
       JOIN matches m ON m.playlist_id = p.id
      WHERE p.alive = 1 AND m.course_id IS NOT NULL AND m.confidence >= 0.75
        AND p.video_count >= ?`
  )
  .all(minVideos) as Row[];

// Free filter 2: the channel earned its line by owning courses, so its
// playlists are its own by construction. This is most of the saving.
const worth = all.filter((r) => !settled.has(r.id) && !vetted.has(r.channelId));

console.log(
  `${all.length} published bindings of ${minVideos}+ videos · ` +
    `${all.length - worth.length} skipped free (settled by hand, or a vetted channel)`
);
console.log(`· ${worth.length} probes, 1 unit each`);

const verdicts: Verdict[] = [];
let probed = 0;
for (const row of worth) {
  let ownership;
  try {
    ownership = await api.playlistOwnership(row.id);
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      console.log(`· quota out after ${probed} probes — the rest stay unjudged`);
      break;
    }
    // A 100-unit call earns a retry; this one costs 1, so the next run asks again.
    if (error instanceof TransientError) continue;
    continue;
  }
  probed += 1;
  if (!ownership.sampled) continue;

  const ownShare = ownership.own / ownership.sampled;
  const [top] = ownership.foreign;
  const topShare = top ? top.count / ownership.sampled : 0;
  const kind =
    ownShare >= OWN_SHARE ? 'own' : top && topShare >= MIRROR_SHARE ? 'mirror' : 'collection';
  verdicts.push({
    ...row,
    sampled: ownership.sampled,
    ownShare,
    kind,
    realOwner: top ? { id: top.id, title: top.title, share: topShare } : undefined,
  });
}

/*
 * Counted off the verdicts rather than off a loop tally, for the reason
 * docs/agents/pitfalls.md gives: a run counter printed as a state of the world
 * announced "0 collections" where there were 309.
 */
const collections = verdicts.filter((v) => v.kind === 'collection');
const mirrors = verdicts.filter((v) => v.kind === 'mirror');
const own = verdicts.filter((v) => v.kind === 'own');

console.log(
  `\n· ${probed} probed · ${own.length} own material · ` +
    `${mirrors.length} mirrors · ${collections.length} collections`
);

const show = (label: string, rows: Verdict[]) => {
  if (!rows.length) return;
  console.log(`\n▸ ${label} — ${rows.length}`);
  for (const v of rows.sort((a, b) => b.videos - a.videos).slice(0, 40)) {
    const owner = v.realOwner ? `  ⇒ ${v.realOwner.title}` : '';
    console.log(
      `  ${String(v.videos).padStart(4)}× ${v.courseId.padEnd(24)} ` +
        `${Math.round(v.ownShare * 100)}% own  ${v.title.slice(0, 52)}${owner}`
    );
  }
};

show('collections — no author, so no course', collections);
show('mirrors — a real course, filed under the wrong channel', mirrors);

/*
 * Which courses are carrying the most of this. A course whose whole visible
 * list is somebody's bookmarks looks full and answers nothing, and that is
 * worse than the empty card docs/harvest.md is willing to show.
 */
const byCourse = new Map<string, number>();
for (const v of collections) byCourse.set(v.courseId, (byCourse.get(v.courseId) ?? 0) + 1);
const worst = [...byCourse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
if (worst.length) {
  console.log(`\n▸ courses holding the most collections`);
  for (const [course, n] of worst) console.log(`  ${String(n).padStart(3)} · ${course}`);
}

if (output) {
  fs.writeFileSync(output, JSON.stringify({ probed, verdicts }, null, 1));
  console.log(`\n· ${output} written`);
}

if (!apply) {
  console.log('· nothing written — re-run with --apply to refuse the collections');
} else if (collections.length) {
  /*
   * Inserted under `matches:` rather than appended to the file, because the
   * keys after it are `playlists` and `channels` and a line in the wrong map is
   * a schema error. The comments in the file are why this is a text edit and
   * not a YAML round-trip: dumping the parsed object back would drop every one
   * of them, and they are the half that says *why*.
   */
  const file = path.join(paths.data, 'overrides.yaml');
  const text = fs.readFileSync(file, 'utf8');
  const at = text.indexOf('\nmatches:\n');
  if (at === -1) throw new Error('overrides.yaml has no `matches:` map');
  const cut = at + '\nmatches:\n'.length;
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `\n  # ${today} — ${collections.length} published bindings whose videos have no`,
    `  # single author: playlistItems said many owners, so there is no course here.`,
    ...collections.map(
      (v) => `  ${v.id}: null  # ${v.videos}× ${v.title.replace(/\s+/g, ' ').slice(0, 60)}`
    ),
    '',
  ].join('\n');
  fs.writeFileSync(file, text.slice(0, cut) + lines + text.slice(cut));
  console.log(`✓ ${collections.length} refusals written to data/overrides.yaml`);
  console.log('  run `pnpm data:build` to take them out of the catalogue');
}

console.log(`· quota spent today: ${api.spent()}`);
