/**
 * Scratch: which channels own the playlists the awesome-lists point at?
 *
 * The academic lists (cs-video-courses, ossu, awesome-math) link *playlists*,
 * not channels — a course at a time. Resolving them in batches of 50 costs a
 * unit each and turns 1700 links into a ranked list of the channels behind
 * them, which is the answer to «what is missing from data/channels.yaml».
 *
 *   pnpm tsx scripts/_owners.ts mined.json owners.json
 */
import fs from 'node:fs';
import { openDb } from './lib/db.js';
import { chunked, createClient, QuotaExceededError } from './lib/youtube.js';

const [input, output] = process.argv.slice(2);
const mined = JSON.parse(fs.readFileSync(input, 'utf8')) as {
  playlists: Array<{ id: string; sources: string[] }>;
};

const db = openDb();
const api = createClient(db);

const sourcesOf = new Map(mined.playlists.map((p) => [p.id, p.sources]));
const owners = new Map<
  string,
  { title: string; playlists: Array<{ id: string; title: string; items: number; sources: string[] }> }
>();

let resolved = 0;
try {
  for (const chunk of chunked([...sourcesOf.keys()], 50)) {
    const items = await api.playlists(chunk);
    resolved += items.length;
    for (const item of items) {
      const key = item.snippet.channelId;
      if (!owners.has(key)) owners.set(key, { title: item.snippet.channelTitle, playlists: [] });
      owners.get(key)!.playlists.push({
        id: item.id,
        title: item.snippet.title,
        items: item.contentDetails.itemCount,
        sources: sourcesOf.get(item.id) ?? [],
      });
    }
  }
} catch (error) {
  if (!(error instanceof QuotaExceededError)) throw error;
  console.log('квота исчерпана, продолжу завтра');
}

const ranked = [...owners.entries()]
  .map(([id, value]) => ({ id, ...value }))
  .sort((a, b) => b.playlists.length - a.playlists.length);

fs.writeFileSync(output, JSON.stringify(ranked, null, 2));
console.log(`· ${resolved} of ${sourcesOf.size} playlists resolved, ${ranked.length} channels behind them`);
for (const channel of ranked.slice(0, 60)) {
  console.log(`${String(channel.playlists.length).padStart(4)}  ${channel.id}  ${channel.title}`);
}
console.log(`· quota spent today: ${api.spent()}`);
db.close();
