import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { nowIso, parseLimit, paths, reportRemaining } from './lib/config.js';
import { openDb } from './lib/db.js';
import { queuePlaylists } from './lib/queue.js';
import { reportSourceError } from './lib/sources.js';

/**
 * Pulls YouTube playlist links out of awesome-lists and course catalogues.
 *
 * A source is either a GitHub repository (`repo` + `path`, read raw) or a plain
 * `url`. The second kind is what reaches Open Yale, NPTEL and MIT OCW — an
 * institution publishing its own curriculum, one playlist per course, which by
 * the finding in docs/channel-hunt.md is the richest shape there is: lists
 * naming playlists are lists of courses, lists naming channels are lists of
 * good videos.
 *
 * Courses that are not already in data/courses/ are never created automatically —
 * the script drops suggestions into data/proposed-courses.yaml, where a human adds
 * them by hand with real `deps`. Auto-generated dependencies are a guaranteed
 * way to ruin the graph, and the graph is the whole product.
 *
 * `pnpm data:import 50` queues fifty new playlists — the lists are read in full
 * either way, since that costs nothing, but the crawl they trigger does not.
 */

const SourceSchema = z.union([
  z.object({
    id: z.string(),
    repo: z.string(),
    path: z.string(),
    branch: z.string().default('master'),
  }),
  z.object({ id: z.string(), url: z.string().url() }),
]);

/**
 * `PL` only. `UU…` is a channel's whole uploads — the most expensive bin there
 * is and never a course — and `OLAK5uy…`, `RD…`, `LL` and `WL` are music
 * albums, mixes and private lists. The two lengths are the legacy hex form and
 * the current one.
 */
const PLAYLIST_ID = /(?:list=|playlist\/)(PL[A-Za-z0-9_-]{16,32})(?![A-Za-z0-9_-])/g;
const MARKDOWN_LINK = /\[([^\]]{3,120})\]\((https?:\/\/[^)\s]+)\)/g;
const HTML_LINK = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]{1,300}?)<\/a>/gi;

type Found = { playlistId: string; title: string; source: string };

/**
 * Every playlist id in the document, with the best title available for it.
 *
 * Titles come from whatever wraps the link — Markdown syntax on GitHub, an
 * anchor on a web page — and are only ever used for the human-facing proposal
 * file, so an id found as a bare URL is kept with an empty one rather than
 * dropped. Scanning the raw text as well as the links is what makes that
 * possible, and it is also a fix: the previous version read Markdown link
 * syntax alone and silently missed every plain URL in the same file.
 */
function extract(text: string): Map<string, string> {
  const titles = new Map<string, string>();

  const remember = (href: string, label: string): void => {
    PLAYLIST_ID.lastIndex = 0;
    const match = PLAYLIST_ID.exec(href);
    if (!match) return;
    const clean = label
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean && !titles.get(match[1])) titles.set(match[1], clean);
  };

  for (const [, label, href] of text.matchAll(MARKDOWN_LINK)) remember(href, label);
  for (const [, href, label] of text.matchAll(HTML_LINK)) remember(href, label);
  for (const [, id] of text.matchAll(PLAYLIST_ID)) if (!titles.has(id)) titles.set(id, '');

  return titles;
}

async function main(): Promise<void> {
  const limit = parseLimit();
  const file = path.join(paths.data, 'sources.yaml');
  const sources = z.array(SourceSchema).parse(parse(fs.readFileSync(file, 'utf8')));

  const found = new Map<string, Found>();

  for (const source of sources) {
    const document = await read(source);
    if (document === null) continue;

    let count = 0;
    for (const [playlistId, title] of extract(document)) {
      if (found.has(playlistId)) continue;
      found.set(playlistId, { playlistId, title, source: source.id });
      count += 1;
    }
    console.log(`· ${source.id}: ${count} playlists`);
  }

  if (!found.size) {
    console.log('✓ nothing new found');
    return;
  }

  // Everything discovered enters the ordinary pipeline: metadata and videos get
  // fetched by the queue, matching happens in 05.
  const db = openDb();
  const { added, skipped } = queuePlaylists(
    db,
    [...found.values()].map((item) => ({ id: item.playlistId, title: item.title })),
    'imported',
    limit
  );

  writeProposals(found);
  db.close();

  console.log(`✓ data:import: ${added} new playlists queued, ${found.size} seen`);
  reportRemaining(skipped, limit);
  console.log('· run `pnpm data:refresh` to fetch them, then `pnpm data:match`');
}

/**
 * Fetches a source, or `null` when it cannot be read — one unreachable
 * catalogue must not cost the run every other one.
 */
async function read(source: z.infer<typeof SourceSchema>): Promise<string | null> {
  const url =
    'url' in source
      ? source.url
      : `https://raw.githubusercontent.com/${source.repo}/${source.branch}/${source.path}`;
  try {
    const response = await fetch(url, {
      // Several course catalogues answer a bare fetch with a challenge page.
      headers: { 'user-agent': 'lectorea-import (+https://github.com/fivol/lectorea)' },
    });
    if (response.ok) return await response.text();

    // On GitHub `master` and `main` are both common; try the other one before
    // giving up. A plain URL has no such second guess.
    if ('repo' in source) {
      const alternative = await fetch(
        url.replace(`/${source.branch}/`, source.branch === 'master' ? '/main/' : '/master/')
      );
      if (alternative.ok) return await alternative.text();
    }
    console.warn(`  ${source.id}: ${response.status}, skipped`);
    return null;
  } catch (error) {
    console.warn(`  ${source.id}: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Titles that mention nothing already in the catalogue are worth a human look;
 * they land here rather than being invented into data/courses/.
 */
function writeProposals(found: Map<string, Found>): void {
  const file = path.join(paths.data, 'proposed-courses.yaml');
  const existing = fs.existsSync(file)
    ? (parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown> | null)
    : null;

  const proposals = {
    generatedAt: nowIso(),
    note:
      'Suggestions from awesome-lists. Add real courses with `pnpm course:new`, ' +
      'with dependencies taken from a syllabus. Nothing here is used by the build.',
    playlists: Object.fromEntries(
      [...found.values()].map((item) => [item.playlistId, { title: item.title, source: item.source }])
    ),
    ...(existing && typeof existing === 'object' ? {} : {}),
  };

  fs.writeFileSync(file, stringify(proposals), 'utf8');
  console.log(`· ${path.relative(paths.root, file)} updated`);
}

main().catch(reportSourceError);
