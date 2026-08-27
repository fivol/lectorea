/**
 * Scratch: what should today buy?
 *
 *   pnpm tsx scripts/_day.ts
 *
 * Every iteration used to start with the same five questions asked five
 * different ways — how much quota is left, is the release ahead of this
 * machine, how much is queued, how many search questions are unasked, how much
 * of the catalogue is waiting on a reader. Each of them is cheap and each of
 * them, got wrong, costs the day: a hunt against an empty pool spends nothing
 * and reports nothing, and a `make pull` over a machine that has been hunting
 * throws the searches away.
 *
 * So this prints the whole state and names the next move. It costs no quota and
 * no network unless `--release` is passed, opens the database **read-only**, and
 * is therefore safe to run beside a crawl — which is the point, since the answer
 * matters most while something long is already running.
 *
 * The question pool is counted through `lib/questions.ts`, the same functions
 * `_hunt.ts` spends it through, so the two cannot drift: a phrasing added to
 * `QUALIFIERS` shows up here as questions to buy on the next run.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dailyQuota, env, paths } from './lib/config.js';
import { openDb, quotaDateKey, type Db } from './lib/db.js';
import { reportRunError } from './lib/exit.js';
import { questionBrief, questionsFor, unaskedQuestions } from './lib/questions.js';

/** ~2.3 units to walk a playlist's videos; `search.list` is 100 a question. */
const VIDEO_WALK = 2.3;
const SEARCH_COST = 100;

function one<T>(db: Db, sql: string, ...args: unknown[]): T {
  return db.prepare(sql).get(...(args as [])) as T;
}

/* ─────────────────────────────  The ledger  ─────────────────────────────── */

function quota(db: Db): {
  day: string;
  keys: number;
  budget: number;
  spent: number;
  left: number;
  untouched: number;
} {
  const day = quotaDateKey();
  const rows = db.prepare(`SELECT key, spent FROM quota WHERE date = ?`).all(day) as Array<{
    key: string;
    spent: number;
  }>;
  const spent = rows.reduce((sum, row) => sum + row.spent, 0);
  const budget = dailyQuota();
  return {
    day,
    keys: env.youtubeKeys.length,
    budget,
    spent,
    left: Math.max(0, budget - spent),
    // A key with no row today has not been touched at all — and an untouched
    // key is the only thing that makes `search.list` the right call.
    untouched: Math.max(0, env.youtubeKeys.length - rows.length),
  };
}

/**
 * Hours until the ledger resets — midnight in Los Angeles, whatever this
 * machine's clock says. Computed by asking what the Pacific day is now and
 * when it next changes, rather than by adding hours to UTC, because the offset
 * moves twice a year and a day is not a duration.
 */
function hoursToReset(now = new Date()): number {
  const today = quotaDateKey(now);
  let lo = 0;
  let hi = 25 * 3600 * 1000;
  while (hi - lo > 60_000) {
    const mid = (lo + hi) / 2;
    if (quotaDateKey(new Date(now.getTime() + mid)) === today) lo = mid;
    else hi = mid;
  }
  return hi / 3_600_000;
}

/* ──────────────────────────────  The stock  ─────────────────────────────── */

function stock(db: Db): Record<string, number> {
  return {
    playlists: one<{ c: number }>(db, `SELECT count(*) c FROM playlists`).c,
    videos: one<{ c: number }>(db, `SELECT count(*) c FROM videos`).c,
    channels: one<{ c: number }>(db, `SELECT count(*) c FROM channels`).c,
    queued: one<{ c: number }>(
      db,
      `SELECT count(*) c FROM jobs WHERE status = 'pending' AND type = 'videos'`
    ).c,
    // Bound confidently, and nobody has confirmed the pairing — so the site
    // does not show it. This is the review debt, and it is the one number that
    // says a day's crawling has not reached the catalogue yet.
    unconfirmed: one<{ c: number }>(
      db,
      `SELECT count(*) c
         FROM playlists p
         JOIN matches m ON m.playlist_id = p.id
         LEFT JOIN verdicts v
                ON v.playlist_id = p.id
               AND (v.course_id IS NULL OR v.course_id = m.course_id)
        WHERE p.alive = 1 AND m.course_id IS NOT NULL AND m.confidence >= 0.75
          AND v.playlist_id IS NULL`
    ).c,
  };
}

/* ────────────────────────────  The two seams  ───────────────────────────── */

function pool(db: Db): { playlist: number; channel: number; en: number } | null {
  try {
    const targets = questionBrief({ min: Number.MAX_SAFE_INTEGER });
    const count = (kind: 'playlist' | 'channel'): number =>
      unaskedQuestions(db, questionsFor(targets, [kind], 'all')).fresh.length;
    return {
      playlist: count('playlist'),
      channel: count('channel'),
      // The English half on its own, because that is the half a launch needs and
      // the total hides it: the pool can be nearly empty overall while the
      // language somebody is shipping in still has questions left.
      en: unaskedQuestions(
        db,
        questionsFor(questionBrief({ min: Number.MAX_SAFE_INTEGER, lang: 'en' }), ['playlist'], 'all')
      ).fresh.length,
    };
  } catch {
    // No built catalogue on this machine yet: `make data` writes the brief.
    return null;
  }
}

/**
 * How much of the catalogue a reader who speaks only English can see.
 *
 * Read off the built playlists rather than off `playlists.lang`, which is null
 * on most rows — the build is where the language of a recording is decided.
 */
function english(): { playlists: number; total: number; empty: string[]; thin: string[] } | null {
  const dir = path.join(paths.outData, 'playlists');
  if (!fs.existsSync(dir)) return null;
  let playlists = 0;
  let total = 0;
  const empty: string[] = [];
  const thin: string[] = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const rows = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Array<{
      lang?: string;
    }>;
    const en = rows.filter((row) => row.lang === 'en').length;
    playlists += en;
    total += rows.length;
    const id = file.slice(0, -5);
    if (en === 0) empty.push(id);
    else if (en < 4) thin.push(id);
  }
  return { playlists, total, empty, thin };
}

/**
 * What the release holds, if asked for. One `gh` call and no quota — but it is
 * network, so it stays behind a flag: a wake-up that only wants to know whether
 * anything is still running should not wait on GitHub.
 */
function release(): { published_at: string; playlists: number; videos: number } | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lectorea-stamp-'));
  try {
    execFileSync(
      'gh',
      ['release', 'download', 'data-cache', '--pattern', 'cache.db.stamp', '-D', dir, '--clobber'],
      { stdio: 'ignore' }
    );
    return JSON.parse(fs.readFileSync(path.join(dir, 'cache.db.stamp'), 'utf8'));
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ─────────────────────────────  What to do  ─────────────────────────────── */

function moves(
  ledger: ReturnType<typeof quota>,
  held: Record<string, number>,
  questions: ReturnType<typeof pool>,
  ahead: ReturnType<typeof release>,
  local: { playlists: number; descends: string | null },
  englishHoles: string[]
): string[] {
  const list: string[] = [];

  // Order matters and is the order of the runbook: a restore or a union goes
  // before anything is spent, because both of them replace rows.
  if (ahead && ahead.published_at !== local.descends) {
    const bigger = ahead.playlists > local.playlists;
    list.push(
      `the release is a generation this cache does not descend from ` +
        `(${ahead.published_at}, ${ahead.playlists} playlists against ${local.playlists} here) — ` +
        (bigger
          ? '`make pull` if nothing was crawled here since'
          : 'both sides hold rows the other lacks') +
        '; `pnpm tsx scripts/_merge.ts <snapshot.db>` prints which, and deletes nothing'
    );
  }

  if (held.queued > 0) {
    list.push(
      `${held.queued} playlists queued ≈ ${Math.round(held.queued * VIDEO_WALK)} units — ` +
        '`make pipeline` (and it refills for free: `make mine && make match`)'
    );
  } else {
    list.push('the video queue is empty — `make mine && make match` before anything is bought');
  }

  if (englishHoles.length) {
    list.push(
      `${englishHoles.length} courses have fewer than four English recordings ` +
        `(${englishHoles.slice(0, 6).join(', ')}${englishHoles.length > 6 ? ', …' : ''}) — ` +
        '`_hunt.ts --lang=en --min=4 --variant=all --apply` asks only in English and ' +
        'only about them'
    );
  }

  if (questions) {
    if (questions.playlist > 0) {
      list.push(
        `${questions.playlist} playlist questions unasked ≈ ${questions.playlist * SEARCH_COST} ` +
          'units — `pnpm tsx scripts/_hunt.ts out.json --kind=playlist --min=999 --variant=all ' +
          '--budget=<what is left> --apply`'
      );
    } else {
      list.push(
        'the playlist question pool is empty — a phrasing in `QUALIFIERS` reopens 472 of them ' +
          '(47 200 units); choose it with `pnpm tsx scripts/_yield.ts`, never by ear'
      );
    }
    if (questions.channel > 0) {
      list.push(
        `${questions.channel} channel questions unasked — worth nothing per binding ` +
          '(every phrasing ever asked bought zero) and one unit a line to vet afterwards; ' +
          'spend on it last'
      );
    }
  }

  if (held.unconfirmed > 0) {
    list.push(
      `${held.unconfirmed} bindings wait on a reader ≈ ${Math.ceil(held.unconfirmed / 150)} ` +
        'batches — `pnpm tsx scripts/_review.ts export <dir> --size=150`, and nothing publishes ' +
        'until they come back'
    );
  }

  if (ledger.left <= 0) {
    list.push('the ledger is empty — the rest of the day is free work: refusals, keywords, docs');
  }
  return list;
}

/* ──────────────────────────────────────────────────────────────────────── */

function main(): void {
  const wantsRelease = process.argv.includes('--release');
  const db = openDb({ readonly: true });

  const ledger = quota(db);
  const held = stock(db);
  const questions = pool(db);
  const descends =
    (one<{ value: string } | undefined>(
      db,
      `SELECT value FROM meta WHERE key = 'snapshot_published_at'`
    )?.value ?? null);
  const ahead = wantsRelease ? release() : null;

  console.log(
    `▸ ${ledger.day} (Pacific) · ${hoursToReset().toFixed(1)} h to the reset · ` +
      `${ledger.keys} keys, ${ledger.untouched} untouched`
  );
  console.log(
    `  quota ${ledger.spent} spent of ${ledger.budget} · ${ledger.left} left ≈ ` +
      `${Math.round(ledger.left / VIDEO_WALK)} playlists walked or ` +
      `${Math.floor(ledger.left / SEARCH_COST)} questions asked`
  );
  console.log(
    `  ${held.playlists} playlists · ${held.videos} videos · ${held.channels} channels · ` +
      `${held.queued} queued · ${held.unconfirmed} unconfirmed`
  );
  if (questions) {
    console.log(
      `  unasked questions: ${questions.playlist} playlist ` +
        `(${questions.en} of them English), ${questions.channel} channel`
    );
  }
  const en = english();
  if (en) {
    console.log(
      `  English: ${en.playlists} of ${en.total} published playlists ` +
        `(${Math.round((en.playlists / Math.max(1, en.total)) * 100)}%) · ` +
        `${en.empty.length} courses with none, ${en.thin.length} with fewer than four`
    );
  }
  if (wantsRelease) {
    console.log(
      ahead
        ? `  release ${ahead.published_at} · ${ahead.playlists} playlists · ${ahead.videos} videos` +
            `${descends === ahead.published_at ? ' — this cache descends from it' : ''}`
        : '  release: could not be read (gh, or no data-cache release)'
    );
  }

  console.log();
  for (const move of moves(
    ledger,
    held,
    questions,
    ahead,
    { playlists: held.playlists, descends },
    en ? [...en.empty, ...en.thin] : []
  )) {
    console.log(`· ${move}`);
  }
  if (!wantsRelease) console.log('\n· --release also asks GitHub what the nightly job published');
}

try {
  main();
} catch (error) {
  reportRunError(error);
}
