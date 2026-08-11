import { nowIso } from './config.js';
import { MATCH_THRESHOLD, type Db } from './db.js';
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
 * every result is worth the same.
 *
 * `matched-first` is for the video crawl, where neither holds. Walking a
 * playlist's videos is the most expensive thing the pipeline does, and a
 * playlist no course claims never reaches the catalogue — the work is spent
 * and nothing is shown for it. Matching is free and needs only the title that
 * discovery already stored, so binding first and crawling second turns the
 * day's quota into catalogue instead of into rows nobody reads. With 7 900
 * playlists queued and one day of quota buying about 4 500 of them, which 4 500
 * is the whole question.
 */
export type JobOrder = 'fifo' | 'matched-first';

const ORDER_BY: Record<JobOrder, string> = {
  fifo: 'jobs.id',
  'matched-first': `
    CASE WHEN EXISTS (SELECT 1 FROM preferred p WHERE p.target = jobs.target) THEN 0 ELSE
      COALESCE((
        SELECT CASE WHEN m.course_id IS NOT NULL
                     AND (m.reviewed = 1 OR m.confidence >= ${MATCH_THRESHOLD})
                    THEN 0 ELSE 1 END
        FROM matches m WHERE m.playlist_id = jobs.target
      ), 1)
    END, jobs.id`,
};

/**
 * Targets to put at the head of a `matched-first` queue whatever the `matches`
 * table says.
 *
 * Hand decisions live in `overrides.yaml`, not in the database — the reviewed
 * record is a file in git, which is what makes it reviewable. So the queue
 * cannot see them, and the playlists a person went to the trouble of binding
 * would be the last ones the crawl paid for. This is how the caller hands them
 * over: a temporary table, dropped with the connection.
 */
export function preferTargets(db: Db, targets: Iterable<string>): number {
  db.exec(`CREATE TEMP TABLE IF NOT EXISTS preferred (target TEXT PRIMARY KEY)`);
  const insert = db.prepare(`INSERT OR IGNORE INTO preferred (target) VALUES (?)`);
  let n = 0;
  db.transaction(() => {
    for (const target of targets) {
      insert.run(target);
      n += 1;
    }
  })();
  return n;
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
 * Runs jobs until the queue drains, the quota does, or `limit` jobs have been
 * taken.
 *
 * Neither a quota stop nor a limit stop is an error — both are a normal end of
 * a run. The process leaves the queue as it is and exits 0, so CI stays green
 * and the next call picks up the jobs this one did not reach.
 */
export async function runWorker(
  db: Db,
  types: JobType[],
  handle: (job: Job) => Promise<void>,
  limit = Infinity,
  order: JobOrder = 'fifo'
): Promise<WorkerResult> {
  // The ordering reads this table whether or not the caller filled it.
  if (order === 'matched-first') preferTargets(db, []);

  const recovered = recoverStale(db);
  if (recovered) console.log(`· recovered ${recovered} jobs left running by a previous crash`);

  const result: WorkerResult = {
    done: 0,
    failed: 0,
    quotaExhausted: false,
    stoppedAtLimit: false,
  };
  let taken = 0;

  for (;;) {
    if (taken >= limit) {
      // Only a stop worth announcing if something is actually left behind.
      result.stoppedAtLimit = pendingCount(db, types) > 0;
      break;
    }
    const job = claim(db, types, order);
    if (!job) break;
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
        break;
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
