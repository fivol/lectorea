/**
 * Scratch: sweep GitHub for playlist links instead of choosing the lists by hand.
 *
 * `data/sources.yaml` names sixteen repositories somebody found once. GitHub
 * holds thousands more files with the same shape — course notes, reading lists,
 * university syllabi, awesome-lists nobody has heard of — and the code search
 * API is free. What it returns is noisy, which by the arithmetic in
 * docs/harvest.md does not matter: vetting a candidate costs one fiftieth of a
 * unit, so the useful property of a source is size, not precision.
 *
 * Needs `gh` authenticated. Search is capped at 100 results a query and about
 * 1000 a term, so the volume comes from asking many narrow questions rather
 * than one broad one — hence the subject list below, which doubles as a way to
 * aim at the fields the catalogue is empty in.
 *
 *   pnpm tsx scripts/_github.ts            # every subject
 *   pnpm tsx scripts/_github.ts linguistics phonetics
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openDb } from './lib/db.js';
import { PLAYLIST_ID_IN_TEXT } from './lib/playlist-id.js';
import { queuePlaylists } from './lib/queue.js';

const run = promisify(execFile);

/**
 * Subjects rather than one bare query, because the cap is per search. Weighted
 * towards the humanities: the crawl is university-heavy and those are the
 * fields it is emptiest in.
 */
const SUBJECTS = [
  'linguistics', 'phonetics', 'syntax semantics', 'philology', 'classics latin',
  'philosophy', 'ancient history', 'art history', 'music theory', 'musicology',
  'political science', 'sociology', 'psychology', 'anthropology', 'archaeology',
  'law', 'economics', 'econometrics', 'demography', 'literature',
  'mathematics', 'statistics', 'physics', 'chemistry', 'biology',
  'neuroscience', 'geology', 'astronomy', 'medicine', 'bioinformatics',
];

/** Which prefixes and lengths count, and why: lib/playlist-id.ts. */
const PLAYLIST_ID = PLAYLIST_ID_IN_TEXT;

/** One argument is one subject, so a rate-limited run can be resumed by name. */
const subjects = process.argv.slice(2).length ? process.argv.slice(2) : SUBJECTS;

/** repo/path pairs, deduped — the same README answers a dozen subjects. */
const files = new Map<string, { repo: string; path: string; branch: string }>();

/**
 * Code search allows ten requests a minute, and exceeding it 403s the rest of
 * the run rather than queuing. Seven seconds between subjects keeps the whole
 * list inside the allowance; thirty subjects is then three and a half minutes,
 * which is nothing against the crawl it feeds.
 */
const PAUSE_MS = 7000;

for (const [index, subject] of subjects.entries()) {
  if (index) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  const query = `"youtube.com/playlist" ${subject} language:markdown`;
  try {
    const { stdout } = await run('gh', [
      'search', 'code', query, '--limit', '100', '--json', 'path,repository',
    ]);
    const results = JSON.parse(stdout) as Array<{
      path: string;
      repository: { nameWithOwner: string; defaultBranchRef?: { name: string } };
    }>;
    for (const result of results) {
      const key = `${result.repository.nameWithOwner}/${result.path}`;
      if (!files.has(key))
        files.set(key, {
          repo: result.repository.nameWithOwner,
          path: result.path,
          branch: result.repository.defaultBranchRef?.name ?? 'HEAD',
        });
    }
    console.log(`· ${subject}: ${results.length} files`);
  } catch (error) {
    // A rate limit or a malformed query must not cost the other subjects.
    console.warn(`  ${subject}: ${(error as Error).message.split('\n')[0]}`);
  }
}

console.log(`· ${files.size} distinct files to read`);

const db = openDb();
const known = new Set(
  (db.prepare(`SELECT id FROM playlists`).all() as Array<{ id: string }>).map((row) => row.id)
);

const found = new Set<string>();
let read = 0;
for (const file of files.values()) {
  const url = `https://raw.githubusercontent.com/${file.repo}/${file.branch}/${file.path}`;
  try {
    const response = await fetch(url);
    if (!response.ok) continue;
    const text = await response.text();
    read += 1;
    for (const [, id] of text.matchAll(PLAYLIST_ID)) if (!known.has(id)) found.add(id);
  } catch {
    // A file that will not download is a file the next sweep can try again.
  }
}

const { added } = queuePlaylists(db, [...found].map((id) => ({ id })), 'github');
db.close();

console.log(`✓ read ${read} files, ${found.size} playlists not already known, ${added} queued`);
console.log('· run `pnpm data:refresh` to fetch them, then `pnpm data:match`');
