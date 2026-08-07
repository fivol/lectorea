import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');

export const paths = {
  root: ROOT,
  data: path.join(ROOT, 'data'),
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
        'See README → Setup for how to obtain one.'
    );
    process.exit(1);
  }
  return env.youtubeKey;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export const nowIso = (): string => new Date().toISOString();
