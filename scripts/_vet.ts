/**
 * Scratch: does a candidate channel earn a line in data/channels.yaml?
 *
 * The bar the file states is *structured courses* — several playlists of ~10+
 * lectures that name a subject. This resolves each candidate, lists what it
 * owns and prints the numbers that answer that, so the decision is made against
 * the API rather than against a blurb in somebody's awesome-list.
 *
 *   pnpm tsx scripts/_vet.ts candidates.txt out.json
 *
 * One channel costs 1 unit plus 1 per 50 playlists, and the spend goes through
 * the same ledger as the crawl.
 */
import fs from 'node:fs';
import { openDb } from './lib/db.js';
import { createClient } from './lib/youtube.js';
import { NotFoundError, QuotaExceededError } from './lib/youtube.js';

const [input, output] = process.argv.slice(2);

// `UC…  # why it is here` — the note is for the reader, the id is for the API.
const candidates = fs
  .readFileSync(input, 'utf8')
  .split('\n')
  .map((line) => line.split('#')[0].trim())
  .filter(Boolean);

const db = openDb();
const api = createClient(db);

type Verdict = {
  candidate: string;
  id?: string;
  title?: string;
  playlists?: number;
  courseLike?: number;
  medianItems?: number;
  top?: Array<{ title: string; items: number }>;
  error?: string;
};

const results: Verdict[] = [];

for (const candidate of candidates) {
  try {
    const channel = await api.channel(candidate);
    if (!channel) {
      results.push({ candidate, error: 'not found' });
      console.log(`✗ ${candidate}: not found`);
      continue;
    }
    const playlists = await api.channelPlaylists(channel.id);
    const counts = playlists.map((p) => p.contentDetails.itemCount).sort((a, b) => b - a);
    // "A course" here is a playlist long enough to be a lecture series rather
    // than a topic bin of two videos. The threshold is the same 10 the file
    // states; the top list is printed so a human can see they name subjects.
    const courseLike = counts.filter((n) => n >= 10).length;
    const top = playlists
      .slice()
      .sort((a, b) => b.contentDetails.itemCount - a.contentDetails.itemCount)
      .slice(0, 12)
      .map((p) => ({ title: p.snippet.title, items: p.contentDetails.itemCount }));

    results.push({
      candidate,
      id: channel.id,
      title: channel.title,
      playlists: playlists.length,
      courseLike,
      medianItems: counts.length ? counts[Math.floor(counts.length / 2)] : 0,
      top,
    });
    console.log(
      `${courseLike >= 3 ? '✓' : '?'} ${candidate} — ${channel.title} [${channel.id}] ` +
        `${playlists.length} playlists, ${courseLike} of them 10+`
    );
    for (const t of top.slice(0, 5)) console.log(`      ${String(t.items).padStart(4)}  ${t.title}`);
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      console.log('квота исчерпана, продолжу завтра');
      break;
    }
    const message = error instanceof NotFoundError ? 'not found' : String(error);
    results.push({ candidate, error: message });
    console.log(`✗ ${candidate}: ${message}`);
  }
}

fs.writeFileSync(output, JSON.stringify(results, null, 2));
console.log(`· quota spent today: ${api.spent()}`);
db.close();
