/**
 * Scratch: what each *phrasing* of the hunt actually bought, from the saved bodies.
 *
 *   pnpm tsx scripts/_yield.ts            # per phrasing, per kind
 *   pnpm tsx scripts/_yield.ts ru         # and the queries behind one language
 *
 * `searches` records that a question was asked and how many hits came back, and
 * every playlist question comes back with fifty — so the table cannot tell a
 * phrasing that found a shelf of new courses from one that returned the same
 * fifty playlists the crawl already owned. The answer is in `raw_responses`,
 * which keeps every search body verbatim: the ids are there, and so is the
 * order the phrasings were asked in.
 *
 * What it prints is the **marginal** yield: of the ids a phrasing returned, how
 * many no earlier phrasing of the same course had already returned, and how
 * many of those became a confident binding and then a published one. That is
 * the number a day is planned against — the pool of questions is finite
 * (docs/harvest.md), and once it is empty the only way to buy more is to add a
 * phrasing, at 100 units × every course × both languages × both kinds ≈ a whole
 * day's quota. Whether that is worth doing is exactly "did phrasing three still
 * bring anything phrasings one and two had not".
 */
import Database from 'better-sqlite3';
import { paths } from './lib/config.js';
import { QUALIFIERS, SCHOOL_QUALIFIERS } from './lib/questions.js';

type Body = { items?: Array<{ id?: { playlistId?: string; channelId?: string } }> };

const ORDER: Record<string, string[]> = {
  ru: [...SCHOOL_QUALIFIERS.ru, ...QUALIFIERS.ru],
  en: [...SCHOOL_QUALIFIERS.en, ...QUALIFIERS.en],
};

function phrasingOf(q: string, lang: string): string {
  const lower = q.toLowerCase();
  // Longest first: «школьный курс» ends with «курс» too, and the longer one is
  // the phrasing that was actually appended.
  const found = [...(ORDER[lang] ?? [])]
    .sort((a, b) => b.length - a.length)
    .find((phrase) => lower.endsWith(` ${phrase}`));
  return found ?? '(other)';
}

function main(): void {
  const only = process.argv[2];
  const db = new Database(paths.cacheDb, { readonly: true });

  const asked = new Map(
    (
      db.prepare(`SELECT q, kind, lang, course_id, checked_at FROM searches`).all() as Array<{
        q: string;
        kind: string;
        lang: string;
        course_id: string;
        checked_at: string;
      }>
    ).map((row) => [`${row.kind}:${row.q.toLowerCase()}`, row])
  );

  const known = {
    playlist: new Set(
      (db.prepare(`SELECT id FROM playlists`).all() as Array<{ id: string }>).map((r) => r.id)
    ),
    channel: new Set(
      (db.prepare(`SELECT id FROM channels`).all() as Array<{ id: string }>).map((r) => r.id)
    ),
  };
  const bound = new Set(
    (
      db
        .prepare(`SELECT playlist_id FROM matches WHERE refused = 0 AND course_id IS NOT NULL`)
        .all() as Array<{ playlist_id: string }>
    ).map((r) => r.playlist_id)
  );
  const published = new Set(
    (
      db.prepare(`SELECT playlist_id FROM verdicts WHERE verdict = 'ok'`).all() as Array<{
        playlist_id: string;
      }>
    ).map((r) => r.playlist_id)
  );

  // course → the ids every phrasing before this one had already returned. The
  // walk is in the order the phrasings are defined, which is the order the hunt
  // asks them in, so "marginal" means the same thing here as it does there.
  const seenPerCourse = new Map<string, Set<string>>();
  const rows = db
    .prepare(
      `SELECT request_key, body, fetched_at FROM raw_responses
       WHERE endpoint = 'search' ORDER BY fetched_at`
    )
    .all() as Array<{ request_key: string; body: string; fetched_at: string }>;

  type Cell = {
    queries: number;
    returned: number;
    marginal: number;
    uncrawled: number;
    bound: number;
    published: number;
  };
  const table = new Map<string, Cell>();
  const missed: string[] = [];

  for (const row of rows) {
    let request: { q?: string; type?: string; relevanceLanguage?: string };
    try {
      request = JSON.parse(row.request_key);
    } catch {
      continue;
    }
    const q = request.q ?? '';
    const kind = request.type === 'channel' ? 'channel' : 'playlist';
    const lang = request.relevanceLanguage ?? 'ru';
    const record = asked.get(`${kind}:${q.toLowerCase()}`);
    if (!record) {
      missed.push(q);
      continue;
    }
    if (only && lang !== only) continue;

    const phrasing = phrasingOf(q, lang);
    const key = `${lang} «${phrasing}» ${kind}`;
    const cell = table.get(key) ?? {
      queries: 0,
      returned: 0,
      marginal: 0,
      uncrawled: 0,
      bound: 0,
      published: 0,
    };

    let body: Body;
    try {
      body = JSON.parse(row.body) as Body;
    } catch {
      continue;
    }
    const ids = (body.items ?? [])
      .map((item) => (kind === 'channel' ? item.id?.channelId : item.id?.playlistId))
      .filter((id): id is string => Boolean(id));

    const scope = `${record.course_id}:${kind}`;
    const before = seenPerCourse.get(scope) ?? new Set<string>();
    cell.queries += 1;
    for (const id of new Set(ids)) {
      cell.returned += 1;
      if (before.has(id)) continue;
      before.add(id);
      cell.marginal += 1;
      // "New" is relative to the catalogue now, not to the moment of asking:
      // an id absent from `playlists` today is one the search returned and
      // every later step declined, which is the honest denominator for a
      // phrasing that keeps returning things nothing here wants.
      if (!known[kind].has(id)) cell.uncrawled += 1;
      if (kind === 'playlist' && bound.has(id)) cell.bound += 1;
      if (kind === 'playlist' && published.has(id)) cell.published += 1;
    }
    seenPerCourse.set(scope, before);
    table.set(key, cell);
  }

  const out = [...table.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, cell]) => ({
      phrasing: key,
      queries: cell.queries,
      'ids back': cell.returned,
      'not asked before': cell.marginal,
      'never crawled': cell.uncrawled,
      bound: cell.bound,
      published: cell.published,
      'bound per 100u': +(cell.bound / cell.queries).toFixed(2),
    }));
  console.table(out);

  const totals = out.reduce(
    (sum, row) => ({
      queries: sum.queries + row.queries,
      bound: sum.bound + row.bound,
      published: sum.published + row.published,
    }),
    { queries: 0, bound: 0, published: 0 }
  );
  console.log(
    `· ${totals.queries} bodies read · ${totals.queries * 100} units · ` +
      `${totals.bound} bindings · ${totals.published} of them published`
  );
  if (missed.length) console.log(`· ${missed.length} bodies whose question is not in searches`);
  db.close();
}

main();
