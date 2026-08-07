import fs from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { nowIso, paths } from './lib/config.js';
import { openDb } from './lib/db.js';
import { enqueue } from './lib/queue.js';
import { reportSourceError } from './lib/sources.js';

/**
 * Pulls YouTube playlist links out of awesome-lists.
 *
 * Courses that are not in courses.yaml are never created automatically — the
 * script drops suggestions into data/proposed-courses.yaml, where a human adds
 * them by hand with real `deps`. Auto-generated dependencies are a guaranteed
 * way to ruin the graph, and the graph is the whole product.
 */

const SourceSchema = z.object({
  id: z.string(),
  repo: z.string(),
  path: z.string(),
  branch: z.string().default('master'),
});

const PLAYLIST_RE = /youtube\.com\/(?:playlist\?list=|watch\?[^)\s]*list=)([A-Za-z0-9_-]{12,})/g;
const LINK_RE = /\[([^\]]{3,120})\]\((https?:\/\/[^)\s]+)\)/g;

type Found = { playlistId: string; title: string; source: string };

async function main(): Promise<void> {
  const file = path.join(paths.data, 'sources.yaml');
  const sources = z.array(SourceSchema).parse(parse(fs.readFileSync(file, 'utf8')));

  const found = new Map<string, Found>();

  for (const source of sources) {
    const url = `https://raw.githubusercontent.com/${source.repo}/${source.branch}/${source.path}`;
    let markdown: string;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        // `master` and `main` are both common; try the other one before giving up.
        const alternative = await fetch(
          url.replace(`/${source.branch}/`, source.branch === 'master' ? '/main/' : '/master/')
        );
        if (!alternative.ok) {
          console.warn(`  ${source.id}: ${response.status}, skipped`);
          continue;
        }
        markdown = await alternative.text();
      } else {
        markdown = await response.text();
      }
    } catch (error) {
      console.warn(`  ${source.id}: ${(error as Error).message}`);
      continue;
    }

    let count = 0;
    for (const link of markdown.matchAll(LINK_RE)) {
      const [, title, href] = link;
      PLAYLIST_RE.lastIndex = 0;
      const match = PLAYLIST_RE.exec(href);
      if (!match) continue;
      const playlistId = match[1];
      if (found.has(playlistId)) continue;
      found.set(playlistId, { playlistId, title: title.trim(), source: source.id });
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
  const insert = db.prepare(
    `INSERT INTO playlists (id, channel_id, title, video_count, alive, checked_at, next_refresh_at)
     VALUES (?, 'imported', ?, 0, 1, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  );

  let added = 0;
  const write = db.transaction(() => {
    for (const item of found.values()) {
      const changes = insert.run(item.playlistId, item.title, nowIso(), nowIso()).changes;
      if (changes) {
        enqueue(db, 'videos', item.playlistId);
        added += 1;
      }
    }
  });
  write();

  writeProposals(found);
  db.close();

  console.log(`✓ data:import: ${added} new playlists queued, ${found.size} seen`);
  console.log('· run `pnpm data:refresh` to fetch them, then `pnpm data:match`');
}

/**
 * Titles that mention nothing already in the catalogue are worth a human look;
 * they land here rather than being invented into courses.yaml.
 */
function writeProposals(found: Map<string, Found>): void {
  const file = path.join(paths.data, 'proposed-courses.yaml');
  const existing = fs.existsSync(file)
    ? (parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown> | null)
    : null;

  const proposals = {
    generatedAt: nowIso(),
    note:
      'Suggestions from awesome-lists. Add real courses to courses.yaml by hand, ' +
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
