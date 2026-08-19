/**
 * Moved to `shared/playlist-id.ts`, and re-exported here so the crawl's own
 * imports stay where they were.
 *
 * The move happened when the search box learned to read pasted links: what a
 * playlist id *is* stopped being a fact only the crawler needed and became one
 * both sides read — which is what `shared/` is for. Leaving a copy behind would
 * have been the fourth copy of the pattern, and the header of that file is the
 * story of the third.
 */
export {
  PLAYLIST_ID_RE,
  PLAYLIST_ID_IN_TEXT,
  isPlaylistId,
  playlistIdsIn,
  playlistIdFrom,
} from '../../shared/playlist-id.js';
