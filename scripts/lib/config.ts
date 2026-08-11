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
  mapSvg: path.join(ROOT, 'public/map.svg'),
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

export const env = {
  youtubeKey: process.env.YOUTUBE_API_KEY ?? '',
  openaiKey: process.env.OPENAI_API_KEY ?? '',
  /** Stop the worker at this many units to leave a safety margin under 10 000. */
  quotaCeiling: Number(process.env.YOUTUBE_QUOTA_CEILING ?? 9500),
  defaultLang: process.env.DEFAULT_LANG ?? 'ru',
};

export function requireYoutubeKey(): string {
  if (!env.youtubeKey) {
    console.error(
      'YOUTUBE_API_KEY is not set. Copy .env.example to .env and put the key there.\n' +
        'See docs/setup.md for how to obtain one.'
    );
    process.exit(1);
  }
  return env.youtubeKey;
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
