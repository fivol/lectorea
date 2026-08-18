import { nowIso } from './config.js';
import { MATCH_THRESHOLD, type Db } from './db.js';
import { isPlaylistId } from './playlist-id.js';
import { QuotaExceededError, NotFoundError, TransientError } from './youtube.js';

/**
 * The job queue lives in the same SQLite file as the data, so it survives
 * `kill -9`. A full first crawl does not fit into one day of quota — the queue
 * is not decoration, it is the only way the crawl finishes at all.
 */

export type JobType = 'discover' | 'playlist' | 'videos' | 'liveness';

export type Job = {
  id: number;
  type: JobType;
  target: string;
  attempts: number;
};

/**
 * The order the queue is drained in.
 *
 * `fifo` is insertion order, which is right when every job costs the same and
 * every result is worth the same. `matched-first` is for the video crawl, where
 * neither holds — see the tiers below.
 */
export type JobOrder = 'fifo' | 'matched-first';

/**
 * Walking a playlist's videos is the most expensive thing the pipeline does,
 * and a playlist no course claims never reaches the catalogue — the work is
 * spent and nothing is shown for it. With 7 900 playlists queued and a day of
 * quota buying some 4 500 of them, which 4 500 is the whole question. So the
 * day is spent down five tiers:
 *
 *   0  bound by hand in `overrides.yaml`
 *   1  bound confidently by a pass — this is what gives it hours and a rating
 *   2  claimed too weakly to publish: the review queue, where a crawl pays
 *      twice, in lecture titles a reviewer reads and in the first five names
 *      the model pass is shown
 *   3  nothing claims it yet
 *   4  refused by hand, or a title that names support material rather than a
 *      course. Never shown however much is spent on it, and the expensive end
 *      besides — «Stanford Seminars» is 1150 videos, 47 units for a bin
 */
const ORDER_BY: Record<JobOrder, string> = {
  fifo: 'jobs.id',
  'matched-first': `
    CASE
      WHEN EXISTS (SELECT 1 FROM ranked r WHERE r.target = jobs.target AND r.tier = 0) THEN 0
      WHEN EXISTS (SELECT 1 FROM ranked r WHERE r.target = jobs.target AND r.tier = 4) THEN 4
      ELSE COALESCE((
        SELECT CASE
                 WHEN m.course_id IS NOT NULL
                  AND (m.reviewed = 1 OR m.confidence >= ${MATCH_THRESHOLD}) THEN 1
                 WHEN m.course_id IS NOT NULL THEN 2
                 ELSE 3 END
        FROM matches m WHERE m.playlist_id = jobs.target
      ), 3)
    END, jobs.id`,
};

/**
 * The tiers the queue cannot work out for itself.
 *
 * Tier 0 and tier 4 both come from outside the database. Hand decisions live in
 * `overrides.yaml`, because the reviewed record is a file in git — which is
 * what makes it reviewable — and the rule that recognises support material
 * lives in `lib/rules.ts`. Neither is a table the ordering can join against, so
 * the caller works them out and hands them over: a temporary table, dropped
 * with the connection.
 */
export function rankTargets(
  db: Db,
  tiers: { first?: Iterable<string>; last?: Iterable<string> } = {}
): { first: number; last: number } {
  db.exec(`CREATE TEMP TABLE IF NOT EXISTS ranked (target TEXT PRIMARY KEY, tier INTEGER)`);
  // A target named as both is a refusal that was later bound by hand; the hand
  // decision is the later word and wins.
  const insert = db.prepare(
    `INSERT INTO ranked (target, tier) VALUES (?, ?)
     ON CONFLICT(target) DO UPDATE SET tier = MIN(ranked.tier, excluded.tier)`
  );
  const counted = { first: 0, last: 0 };
  db.transaction(() => {
    for (const target of tiers.last ?? []) {
      insert.run(target, 4);
      counted.last += 1;
    }
    for (const target of tiers.first ?? []) {
      insert.run(target, 0);
      counted.first += 1;
    }
  })();
  return counted;
}

/** 1m, 4m, 16m, 64m — quadratic, which is gentle at first and gives up by the fifth try. */
export function backoffMinutes(attempts: number): number {
  return 4 ** (attempts - 1);
}

const MAX_ATTEMPTS = 5;

export function enqueue(db: Db, type: JobType, target: string): void {
  db.prepare(
    `INSERT INTO jobs (type, target, status, attempts, next_retry_at, updated_at)
     VALUES (?, ?, 'pending', 0, ?, ?)
     ON CONFLICT(type, target) DO UPDATE SET
       status = CASE WHEN jobs.status = 'done' THEN 'pending' ELSE jobs.status END,
       next_retry_at = excluded.next_retry_at,
       updated_at = excluded.updated_at`
  ).run(type, target, nowIso(), nowIso());
}

/**
 * The one door every discovered playlist comes through, whatever found it —
 * an awesome-list, a course catalogue, a mined description, a GitHub sweep.
 *
 * The row is written with no metadata and `next_refresh_at` already due, so the
 * next refresh fetches the title and the owning channel before anything decides
 * what the playlist is. `channelId` is a placeholder naming the finder, which
 * survives exactly until that refresh and is worth having until then: a
 * playlist that never resolves is traceable to whatever suggested it.
 *
 * The limit applies to genuinely new rows, so running the same command again
 * continues where it stopped instead of redoing the same head of the list.
 *
 * Being the one door is also what makes it the right place to check the id is
 * an id. Everything arriving here was scraped out of prose, and prose supplies
 * share links glued to the next word, hand-typed ids and half-copied URLs — an
 * id malformed in a way no pattern anticipated still costs four requests on the
 * retry ladder before the API's `400` is believed. A caller may extract however
 * it likes; nothing that is not a playlist id gets a row. See playlist-id.ts
 * for which forms exist and what the 245 rows that taught this cost.
 */
export function queuePlaylists(
  db: Db,
  items: Iterable<{ id: string; title?: string }>,
  origin: string,
  limit = Infinity
): { added: number; skipped: number; rejected: number } {
  const insert = db.prepare(
    `INSERT INTO playlists (id, channel_id, title, video_count, alive, checked_at, next_refresh_at, found_at)
     VALUES (?, ?, ?, 0, 1, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  );
  const exists = db.prepare(`SELECT 1 FROM playlists WHERE id = ?`);

  let added = 0;
  let skipped = 0;
  let rejected = 0;
  db.transaction(() => {
    for (const item of items) {
      if (!isPlaylistId(item.id)) {
        rejected += 1;
        continue;
      }
      if (added >= limit) {
        if (!exists.get(item.id)) skipped += 1;
        continue;
      }
      if (insert.run(item.id, origin, item.title || null, nowIso(), nowIso(), nowIso()).changes) {
        enqueue(db, 'videos', item.id);
        added += 1;
      }
    }
  })();

  return { added, skipped, rejected };
}

/**
 * Jobs left `running` by a crashed process are returned to the pool.
 * Ten minutes is longer than any single job legitimately takes.
 */
export function recoverStale(db: Db): number {
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  return db
    .prepare(
      `UPDATE jobs SET status = 'pending', updated_at = ?
       WHERE status = 'running' AND updated_at < ?`
    )
    .run(nowIso(), cutoff).changes;
}

/** Claims one job atomically, so two workers never take the same one. */
function claim(db: Db, types: JobType[], order: JobOrder): Job | null {
  const placeholders = types.map(() => '?').join(',');
  const take = db.transaction((): Job | null => {
    const row = db
      .prepare(
        `SELECT id, type, target, attempts FROM jobs
         WHERE status = 'pending' AND type IN (${placeholders})
           AND (next_retry_at IS NULL OR next_retry_at <= ?)
         ORDER BY ${ORDER_BY[order]} LIMIT 1`
      )
      .get(...types, nowIso()) as Job | undefined;
    if (!row) return null;
    db.prepare(`UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ?`).run(
      nowIso(),
      row.id
    );
    return row;
  });
  return take();
}

export function markDone(db: Db, id: number): void {
  db.prepare(`UPDATE jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?`).run(
    nowIso(),
    id
  );
}

export function markFailed(db: Db, id: number, error: unknown): void {
  db.prepare(`UPDATE jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`).run(
    String(error),
    nowIso(),
    id
  );
}

function scheduleRetry(db: Db, job: Job, error: unknown): void {
  const attempts = job.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    markFailed(db, job.id, error);
    return;
  }
  const next = new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString();
  db.prepare(
    `UPDATE jobs SET status = 'pending', attempts = ?, last_error = ?, next_retry_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(attempts, String(error), next, nowIso(), job.id);
}

export function pendingCount(db: Db, types: JobType[]): number {
  const placeholders = types.map(() => '?').join(',');
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs WHERE status = 'pending' AND type IN (${placeholders})`
    )
    .get(...types) as { n: number };
  return row.n;
}

export type WorkerResult = {
  done: number;
  failed: number;
  quotaExhausted: boolean;
  stoppedAtLimit: boolean;
};

/**
 * How many jobs are in flight at once.
 *
 * One at a time is latency-bound, not quota-bound: every unit is one request,
 * so a round trip of a second caps the day at some 3500 units however much
 * quota is left. A handful in flight spends the day in the day. It stays a
 * handful because the burst limit is real — `rateLimitExceeded` is a 403 the
 * API returns for asking too fast, and the point is to spend the quota, not to
 * race it.
 */
const CONCURRENCY = 6;

/**
 * Runs jobs until the queue drains, the quota does, or `limit` jobs have been
 * taken.
 *
 * Neither a quota stop nor a limit stop is an error — both are a normal end of
 * a run. The process leaves the queue as it is and exits 0, so CI stays green
 * and the next call picks up the jobs this one did not reach.
 *
 * Jobs run several at a time. `claim` is a transaction, so no two workers take
 * the same one, and the quota ledger is checked before every call — with
 * requests in flight the ceiling can be passed by at most a few units, which is
 * what the margin under 10 000 is for.
 */
export async function runWorker(
  db: Db,
  types: JobType[],
  handle: (job: Job) => Promise<void>,
  limit = Infinity,
  order: JobOrder = 'fifo'
): Promise<WorkerResult> {
  // The ordering reads this table whether or not the caller filled it.
  if (order === 'matched-first') rankTargets(db);

  const recovered = recoverStale(db);
  if (recovered) console.log(`· recovered ${recovered} jobs left running by a previous crash`);

  const result: WorkerResult = {
    done: 0,
    failed: 0,
    quotaExhausted: false,
    stoppedAtLimit: false,
  };
  let taken = 0;
  let stop = false;

  /** One worker, taking the next job until there is a reason to stop. */
  async function drain(): Promise<void> {
    for (;;) {
      if (stop) return;
      if (taken >= limit) {
        // Only a stop worth announcing if something is actually left behind.
        result.stoppedAtLimit = pendingCount(db, types) > 0;
        stop = true;
        return;
      }
      const job = claim(db, types, order);
      if (!job) return;
      taken += 1;

      try {
        await handle(job);
        markDone(db, job.id);
        result.done += 1;
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          // Put it straight back — nothing about this job was wrong.
          db.prepare(`UPDATE jobs SET status = 'pending', updated_at = ? WHERE id = ?`).run(
            nowIso(),
            job.id
          );
          result.quotaExhausted = true;
          // Everything else in flight will hit the same wall on its next call.
          stop = true;
          return;
        }
        if (error instanceof NotFoundError) {
          // A deleted or private target will never come back. Retrying wastes quota.
          markFailed(db, job.id, error);
          result.failed += 1;
          continue;
        }
        if (error instanceof TransientError || error instanceof Error) {
          scheduleRetry(db, job, error);
          continue;
        }
        throw error;
      }
    }
  }

  const workers = Math.max(1, Math.min(CONCURRENCY, Number.isFinite(limit) ? limit : CONCURRENCY));
  await Promise.all(Array.from({ length: workers }, () => drain()));

  return result;
}

export function reportWorker(name: string, result: WorkerResult): void {
  if (result.quotaExhausted) {
    console.log(
      `${name}: квота исчерпана, продолжу завтра ` +
        `(готово ${result.done}, ошибок ${result.failed})`
    );
    return;
  }
  if (result.stoppedAtLimit) {
    console.log(`${name}: лимит выбран (готово ${result.done}, ошибок ${result.failed})`);
    return;
  }
  console.log(`✓ ${name}: ${result.done} done, ${result.failed} failed`);
}
