/**
 * What the raw archive is allowed to keep, and for how long.
 *
 * `raw_responses` exists so a parser can be fixed and re-run without spending
 * the quota again. That is worth a lot and it is worth it *briefly*: on
 * 2026-08-27 the table was 28.2 GB of a 32 GB cache, sixteen days of crawling
 * at 1.8 GB a day, on a laptop with 14 GB of disk left. Left alone under a
 * scheduled harvest it fills the disk in a week, and a disk that fills during a
 * crawl takes the crawl with it.
 *
 * The fix is not a smaller archive, it is noticing that a row does two jobs
 * with two different lifetimes:
 *
 *   the ledger · `endpoint`, `request_key`, `fetched_at` — which question was
 *                asked, and when. A few hundred bytes, and the value never
 *                expires: it is what `_found.ts` reconstructs first sightings
 *                from, and the record of what the quota actually bought.
 *   the body   · what the answer said. 145 KB a row for `videos`, and the value
 *                is gone as soon as nobody would re-run a parser over it.
 *
 * Stored as one row, the permanent half drags the temporary half along for
 * ever. So the ledger row is never deleted and the body is; `_found.ts` reads
 * request keys out of `idx_raw_key` and only touches bodies for the `playlists`
 * endpoint, so emptying the rest costs it nothing.
 *
 * Two rules, and the measurements behind them are in
 * [docs/pipeline.md](../../docs/pipeline.md#the-raw-archive-is-bounded).
 */

/**
 * Keys removed from a stored body. An endpoint absent from here is archived
 * verbatim.
 *
 * Only the two bulk endpoints are touched, and only where the bytes are
 * provably not information. Measured over 9336 videos on 2026-08-27:
 *
 *   localized  · 36.9% of the `videos` archive — 9.1 GB — and identical to the
 *                `title` and `description` beside it in 9336 of 9336. It has to
 *                be: `hl` is never passed, so YouTube echoes the default locale.
 *   thumbnails · 8.7%, and all 44 651 URLs sampled were
 *                `https://i.ytimg.com/vi/<the item's own id>/…`. Derivable.
 *   tags       · 6.2%, read by nothing here. The one judgement call of the
 *                three: unlike the other two it cannot be rebuilt, and it was
 *                dropped because a year of storing it had never been read.
 *   etag, kind · HTTP envelope. 60.7% of a `playlistItems` body, whose whole
 *                payload is a list of video ids that `videos` already holds.
 *
 * `description` stays: it is the seam `11-mine` reads, and no table has it.
 *
 * `search`, `playlists` and `channels` are left alone — 482 MB between them,
 * against a search page that costs 100 units and a `playlists` body that
 * `_found.ts` reads for first sightings.
 */
const DROPPED: Record<string, ReadonlySet<string>> = {
  videos: new Set(['etag', 'kind', 'localized', 'thumbnails', 'tags']),
  playlistItems: new Set(['etag', 'kind']),
};

/**
 * Endpoints whose bodies outlive the window.
 *
 * Small and dear: a `search` body is 100 units of quota and the only record of
 * what a phrasing returned (`_yield.ts` reads every one of them in order), a
 * `playlists` body is what `_found.ts` reconstructs a first sighting from.
 * Together they are under half a gigabyte, which is not what this is about.
 */
export const BODIES_KEPT_FOREVER: ReadonlySet<string> = new Set([
  'playlists',
  'search',
  'channels',
]);

/**
 * How long a `videos` or `playlistItems` body is worth its disk.
 *
 * The window is the gap between a crawl and someone noticing its parser was
 * wrong. Three days covers a weekend, and the price of the fourth is a
 * gigabyte. Everything durable a body holds is extracted before it expires:
 * `found_at` by the insert that wrote the row, playlist ids by `data:mine`,
 * which the pipeline runs after every crawl and `cache:prune` refuses to run
 * without.
 */
export const BODY_RETENTION_DAYS = 3;

/**
 * The body as it should be stored: JSON text with the dead weight left out.
 *
 * A `JSON.stringify` replacer rather than a clone-and-delete, because the
 * caller of `saveRaw` goes on to use the object it passed in — a 24 GB lesson
 * would be a mutation here silently emptying `snippet` for the parser two lines
 * down — and because one pass over a 145 KB body is cheaper than two.
 */
export function serializeBody(endpoint: string, body: unknown): string {
  const dropped = DROPPED[endpoint];
  if (!dropped) return JSON.stringify(body);
  return JSON.stringify(body, (key, value) => (dropped.has(key) ? undefined : value));
}

/** The same policy applied to a body already on disk. Null when it is not JSON. */
export function restripStored(endpoint: string, stored: string): string | null {
  if (!DROPPED[endpoint]) return stored;
  try {
    return serializeBody(endpoint, JSON.parse(stored));
  } catch {
    // A truncated body is not worth a failed prune: it is dropped in the
    // rebuild rather than carried, and the ledger row survives either way.
    return null;
  }
}

/**
 * The ISO instant before which `videos` and `playlistItems` bodies expire.
 *
 * Milliseconds on purpose, against the rule that a day is not a duration
 * ([pitfalls](../../docs/agents/pitfalls.md#a-day-was-moved-by-adding-86-400-000-milliseconds)).
 * That rule is about calendar days, and this is not one: the window is
 * "the last seventy-two hours of answers", `fetched_at` is a UTC instant, and
 * comparing instants is what makes it mean the same thing in every zone. Going
 * through a local calendar here would put the timezone back in.
 */
export function retentionCutoff(now: Date, days = BODY_RETENTION_DAYS): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
