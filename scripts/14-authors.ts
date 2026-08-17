/**
 * Who made the videos under the bindings the catalogue is showing.
 *
 * The rule pass reads a title, and a title cannot say who filmed anything.
 * «Linguistics» with 268 videos in it is a course when a linguist uploaded all
 * 268 and a bag of bookmarks when they come from forty channels, and the two
 * are identical to every rule in `lib/rules.ts`. `playlistItems.list` carries
 * the owner of each video beside the owner of the playlist, so one page of
 * fifty settles it for one unit.
 *
 * `_hunt.ts` has asked this of *candidates* since 2026-08-15 and refuses about
 * 95% of them. This step asks it of what is already **published**, which no
 * pass ever had: everything bound before the probe existed was decided on its
 * title alone. The first run over 40+ videos found 17 collections, among them
 * «Filme» (the films, under film studies) and 752 videos under one CMU course
 * code.
 *
 *   pnpm data:authors            # everything due, cheapest first
 *   pnpm data:authors 200        # cap the run, leave the rest for the next
 *   pnpm data:authors --recheck  # ask again about playlists already judged
 *
 * There are three answers and only one is a refusal:
 *
 *   own          the channel made what it listed — a course, left alone;
 *   mirror       one outside channel made almost all of it. Still a real
 *                course, so it keeps its binding: the fault is the provider it
 *                is filed under, and dropping it would delete material that in
 *                24 of 34 cases exists nowhere else in the catalogue;
 *   collection   many owners and no author. Refused.
 *
 * A refusal here is the same reversible verdict `05-match.ts` writes: it never
 * touches a `reviewed` row or anything in `overrides.yaml`, and `data:match
 * --force` re-reads it like any other.
 */
import { openDb, type Db } from './lib/db.js';
import { reportRunError } from './lib/exit.js';
import { loadSources } from './lib/sources.js';
import { createClient, QuotaExceededError, TransientError } from './lib/youtube.js';

/**
 * Below this a wrong binding is one card among many; above it, it *is* what the
 * course shows. The probe costs a unit either way, so the floor is about where
 * the damage is rather than about the price.
 */
const MIN_VIDEOS = 40;

/** The channel made most of what it listed. `_hunt.ts` judges on the same two. */
const OWN_SHARE = 0.6;
const MIRROR_SHARE = 0.5;

type Candidate = {
  id: string;
  title: string;
  videos: number;
  channelId: string;
  courseId: string;
};

/**
 * Channels named in `channels.yaml`, under either name they can have here.
 *
 * The file is written in handles because a handle is readable and the API
 * answers `UC…`; comparing the two sets directly is the mistake that once
 * reported YaleCourses as never crawled. A vetted channel is skipped for free —
 * it earned its line by owning the courses it publishes, and that is where most
 * of the saving in this step comes from.
 */
function vettedChannels(db: Db, configured: Set<string>): Set<string> {
  const vetted = new Set<string>();
  const rows = db.prepare(`SELECT id, handle FROM channels`).all() as Array<{
    id: string;
    handle: string | null;
  }>;
  for (const row of rows) {
    const handle = row.handle ? row.handle.toLowerCase().replace(/^@/, '') : null;
    if (configured.has(row.id.toLowerCase()) || (handle && configured.has(handle))) {
      vetted.add(row.id);
    }
  }
  return vetted;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const recheck = argv.includes('--recheck');
  const limit = Number(argv.find((a) => /^\d+$/.test(a)) ?? 0) || Infinity;
  const minVideos =
    Number(argv.find((a) => a.startsWith('--min='))?.slice(6) ?? MIN_VIDEOS) || MIN_VIDEOS;

  const db = openDb();
  const sources = loadSources();
  const api = createClient(db);

  const configured = new Set(sources.channels.map((c) => c.id.toLowerCase().replace(/^@/, '')));
  const vetted = vettedChannels(db, configured);
  const settled = new Set(Object.keys(sources.overrides.matches));

  const published = db
    .prepare(
      `SELECT p.id, p.title, p.video_count AS videos, p.channel_id AS channelId,
              m.course_id AS courseId
         FROM playlists p
         JOIN matches m ON m.playlist_id = p.id
        WHERE p.alive = 1 AND m.course_id IS NOT NULL AND m.confidence >= 0.75
          AND m.reviewed = 0 AND p.video_count >= ?`
    )
    .all(minVideos) as Candidate[];

  // Already answered, and the answer does not change. This is what makes the
  // step nightly-safe: the second run costs almost nothing.
  const judged = new Set(
    (db.prepare(`SELECT playlist_id FROM ownership`).all() as Array<{ playlist_id: string }>).map(
      (r) => r.playlist_id
    )
  );

  const due = published.filter(
    (row) =>
      !settled.has(row.id) && !vetted.has(row.channelId) && (recheck || !judged.has(row.id))
  );

  console.log(
    `· ${published.length} published bindings of ${minVideos}+ videos · ` +
      `${published.length - due.length} skipped free (hand-settled, vetted channel, or already judged)`
  );
  if (!due.length) {
    console.log('· nothing due — every binding worth a unit has been asked');
    db.close();
    return;
  }

  const batch = due.slice(0, limit === Infinity ? due.length : limit);
  console.log(`· ${batch.length} probes, 1 unit each`);

  const remember = db.prepare(
    `INSERT INTO ownership (playlist_id, sampled, own_share, kind, owner_id, owner_title, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(playlist_id) DO UPDATE SET
       sampled = excluded.sampled, own_share = excluded.own_share, kind = excluded.kind,
       owner_id = excluded.owner_id, owner_title = excluded.owner_title,
       checked_at = excluded.checked_at`
  );

  /*
   * The same shape `05-match.ts` refuses with, and for the same reasons: out of
   * the review queue, last in the video queue, reversible by `--force`, and
   * guarded by `reviewed = 0` so it can never overwrite a person's answer.
   */
  const refuse = db.prepare(
    `UPDATE matches SET course_id = NULL, confidence = 0, method = 'ownership',
                        refused = 1, updated_at = ?
      WHERE playlist_id = ? AND reviewed = 0`
  );

  const counts = { probed: 0, own: 0, mirrors: 0, collections: 0 };
  const refused: Candidate[] = [];
  const mirrors: Array<Candidate & { owner: string }> = [];

  for (const row of batch) {
    let ownership;
    try {
      ownership = await api.playlistOwnership(row.id);
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        console.log(`· quota out after ${counts.probed} probes — the rest stay for the next run`);
        break;
      }
      // One unit, and the queue will come back to it: unlike `search.list`
      // there is nothing here worth retrying in place.
      if (error instanceof TransientError) continue;
      continue;
    }
    counts.probed += 1;
    if (!ownership.sampled) continue;

    const ownShare = ownership.own / ownership.sampled;
    const [top] = ownership.foreign;
    const topShare = top ? top.count / ownership.sampled : 0;
    const kind =
      ownShare >= OWN_SHARE ? 'own' : top && topShare >= MIRROR_SHARE ? 'mirror' : 'collection';

    const now = new Date().toISOString();
    remember.run(
      row.id,
      ownership.sampled,
      ownShare,
      kind,
      top?.id ?? null,
      top?.title ?? null,
      now
    );

    if (kind === 'own') counts.own += 1;
    else if (kind === 'mirror') {
      counts.mirrors += 1;
      mirrors.push({ ...row, owner: top?.title ?? '?' });
    } else {
      counts.collections += 1;
      refuse.run(now, row.id);
      refused.push(row);
    }
  }

  /*
   * Printed off the collected rows rather than off the loop's tallies, because
   * a counter that describes a run gets printed as a state of the world the
   * first time the run does not happen.
   */
  console.log(
    `\n· ${counts.probed} probed · ${counts.own} own material · ` +
      `${counts.mirrors} mirrors kept · ${refused.length} collections refused`
  );

  for (const row of refused.sort((a, b) => b.videos - a.videos).slice(0, 20)) {
    console.log(`  ✗ ${String(row.videos).padStart(4)}× ${row.courseId.padEnd(22)} ${row.title.slice(0, 54)}`);
  }

  /*
   * Mirrors are not refused and are not silent either: the binding is right and
   * the provider under it is wrong. `08-build.ts` now reads `kind = 'mirror'`
   * and files the playlist under whoever made the videos, so the row written
   * above *is* the fix and there is nothing to do by hand.
   *
   * What is still worth printing is the owner's name, because it is the
   * cheapest channel candidate this catalogue produces — a channel it has
   * already chosen, by name, from material it already publishes. Two thirds of
   * `channels.yaml` arrived this way (docs/harvest.md).
   */
  if (mirrors.length) {
    console.log(`\n· ${mirrors.length} filed under whoever made them, not whoever listed them:`);
    for (const row of mirrors.sort((a, b) => b.videos - a.videos).slice(0, 15)) {
      console.log(
        `  ⇒ ${String(row.videos).padStart(4)}× ${row.courseId.padEnd(22)} ` +
          `${row.title.slice(0, 40)} — really ${row.owner}`
      );
    }
    console.log('  the owners not yet in channels.yaml are the next hunt, already vetted');
  }

  const left = due.length - batch.length;
  if (left > 0) console.log(`\n· ${left} left for the next run`);
  console.log(`· quota spent today: ${api.spent()}`);
  db.close();
}

main().catch(reportRunError);
