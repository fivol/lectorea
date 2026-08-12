import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');

export const paths = {
  root: ROOT,
  data: path.join(ROOT, 'data'),
  courses: path.join(ROOT, 'data/courses'),
  i18n: path.join(ROOT, 'data/i18n'),
  keywords: path.join(ROOT, 'data/keywords'),
  cacheDb: path.join(ROOT, 'data/cache.db'),
  publicDir: path.join(ROOT, 'public'),
  outData: path.join(ROOT, 'public/data'),
  outPlaylists: path.join(ROOT, 'public/data/playlists'),
  outImages: path.join(ROOT, 'public/images'),
  domainImages: path.join(ROOT, 'public/images/domains'),
  courseImages: path.join(ROOT, 'public/images/courses'),
  /** The wide map, for a window wider than it is tall. */
  mapSvg: path.join(ROOT, 'public/map.svg'),
  /** The same world stacked into a tall one, for a phone held upright. */
  mapPortraitSvg: path.join(ROOT, 'public/map-portrait.svg'),
};

/** Reads .env once, without pulling dotenv into the frontend bundle. */
function loadEnv(): void {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

/**
 * Every YouTube key in the environment, in the order they are spent.
 *
 * The 10 000 units are a **project's**, not a key's, so a second key buys a
 * second day only when it comes from a second Google Cloud project — two keys
 * of one project share one budget and the crawler will simply find the second
 * already empty. Slots are numbered rather than comma-separated so a key can be
 * commented out on its own line, and identical values are collapsed: the same
 * key pasted twice is one budget, and counting it as two would make every
 * estimate lie.
 */
function youtubeKeys(): string[] {
  const slots = ['YOUTUBE_API_KEY', ...range(2, 9).map((n) => `YOUTUBE_API_KEY${n}`)];
  return [...new Set(slots.map((slot) => (process.env[slot] ?? '').trim()).filter(Boolean))];
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export const env = {
  youtubeKeys: youtubeKeys(),
  openaiKey: process.env.OPENAI_API_KEY ?? '',
  /** Stop at this many units **per key**, leaving a safety margin under 10 000. */
  quotaCeiling: Number(process.env.YOUTUBE_QUOTA_CEILING ?? 9500),
  defaultLang: process.env.DEFAULT_LANG ?? 'ru',
};

/**
 * What all the keys together buy in a day — the divisor behind every "so many
 * days of crawling left" estimate. Floored at one key so a report can still be
 * rendered on a machine with no key at all.
 */
export function dailyQuota(): number {
  return Math.max(1, env.youtubeKeys.length) * env.quotaCeiling;
}

export function requireYoutubeKeys(): string[] {
  if (env.youtubeKeys.length === 0) {
    console.error(
      'YOUTUBE_API_KEY is not set. Copy .env.example to .env and put the key there.\n' +
        'See docs/setup.md for how to obtain one.'
    );
    process.exit(1);
  }
  return env.youtubeKeys;
}

/**
 * A leading positive integer caps how many items one run takes on:
 * `pnpm data:discover 3` crawls three channels and leaves the rest for later.
 *
 * The cap is only useful because every step already skips what it finished — a
 * refresh window that has not expired, a job marked `done`, a playlist that
 * already has a match — so running the same command again continues with the
 * next three rather than redoing the first three. Flags are ignored, which
 * keeps `pnpm data:match 20 --llm` working.
 */
export function parseLimit(argv: string[] = process.argv.slice(2)): number {
  const first = argv.find((argument) => !argument.startsWith('-'));
  if (first === undefined) return Infinity;
  const value = Number(first);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`The limit must be a positive integer, got "${first}".`);
    process.exit(1);
  }
  return value;
}

/** `· 12 left, run again to take the next 3` — the nudge that makes batching obvious. */
export function reportRemaining(remaining: number, limit: number): void {
  if (remaining <= 0) return;
  console.log(
    Number.isFinite(limit)
      ? `· ${remaining} left — run the same command again for the next ${limit}`
      : `· ${remaining} left`
  );
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export const nowIso = (): string => new Date().toISOString();
