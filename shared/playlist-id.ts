/**
 * What a YouTube playlist id is, in one place.
 *
 * This module exists because of a bug that cost real quota. Three scripts each
 * kept their own copy of the extraction regex, all three written as
 * `PL[A-Za-z0-9_-]{16,32}`, and all three carrying a comment saying the id is
 * "16 or 32 characters after the prefix". A comma in a quantifier is a *range*,
 * not a choice: the pattern accepted every length from 18 to 34, so a link
 * followed immediately by punctuation-free junk — `…mhlB2TqF473`, a share URL
 * glued to the next word by a broken Markdown table — produced an id that
 * looked plausible and cannot exist. 245 such rows reached the database and 240
 * of them reached the video queue, where each one spent four requests earning
 * `400 Invalid Value` on the retry ladder before being written off.
 *
 * The shape of that bug is the reason for this file rather than a one-character
 * edit in three places. A pattern duplicated three times is a pattern that will
 * be duplicated a fourth, and the fourth copy will be written from the same
 * comment that was already wrong twice.
 *
 * It lives in `shared/` because both sides read it now: the crawl, to refuse an
 * id before it costs a request, and the search box, to tell a playlist the
 * catalogue could contain from a link that could never be one — a music album,
 * a mix, somebody's watch-later — before offering to have it added.
 *
 * The three forms below are the ones the API itself has answered for in this
 * crawl — counted over 32 914 rows, every id that ever resolved is one of them,
 * and every id that is none of them is dead:
 *
 *   `PL` + 32   the current form                       29 670 alive
 *   `PL` + 16   the legacy form, uppercase hex          1 406 alive
 *   `PL` + 11   a playlist keyed by a video id             77 alive
 *
 * `PL` only, and deliberately: `UU…` is a channel's entire uploads — the most
 * expensive bin there is and never a course; `OLAK5uy…` is an auto-generated
 * music album; `RD`, `LL` and `WL` are mixes and private lists that resolve to
 * nothing. `FL…` (a channel's Favorites) is a real form, but it arrives from
 * the API during discovery rather than out of prose, so it never comes through
 * here.
 */

/** The id itself, anchored — the three forms above and nothing else. */
export const PLAYLIST_ID_RE = /^PL(?:[A-Za-z0-9_-]{32}|[0-9A-F]{16}|[A-Za-z0-9_-]{11})$/;

/**
 * The same three forms, as they appear inside prose: after `list=` or
 * `/playlist/`, and not run into more id characters on either side.
 *
 * The lookahead is what the range quantifier was silently doing without: an id
 * glued to trailing junk must be *refused*, not truncated to a plausible
 * prefix, because a truncated id is indistinguishable from a real one until the
 * API charges for the answer.
 *
 * Longest alternative first — a regex alternation is ordered, so `PL` + 11
 * placed first would match the opening 13 characters of every modern id and the
 * lookahead would then reject the lot.
 */
export const PLAYLIST_ID_IN_TEXT =
  /(?:list=|playlist\/)(PL(?:[A-Za-z0-9_-]{32}|[0-9A-F]{16}|[A-Za-z0-9_-]{11}))(?![A-Za-z0-9_-])/g;

/** Is this a playlist id YouTube could actually answer for? */
export function isPlaylistId(id: string): boolean {
  return PLAYLIST_ID_RE.test(id);
}

/**
 * Every playlist id in a piece of text, deduplicated, in the order found.
 *
 * `String.matchAll` needs the `g` flag and a regex object carries `lastIndex`
 * across calls, so the pattern is rebuilt per call rather than shared — the
 * alternative is a module-level object whose state depends on who scanned last.
 */
export function playlistIdsIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(new RegExp(PLAYLIST_ID_IN_TEXT))) found.add(match[1]);
  return [...found];
}
