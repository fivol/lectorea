/**
 * Reading a YouTube address, whatever shape it was copied in.
 *
 * A reader who was sent a course does not retype its title — they paste the
 * link, and every one of them is a different link: the playlist page, a lecture
 * out of it with `list=` still attached, the mobile host, the share form with
 * its tracking parameter, sometimes the bare id out of an address bar. All of
 * them name the same playlist, and the catalogue already knows that id — it is
 * the `id` of the playlist's own search entry, so a link costs no index and no
 * data, only the reading.
 *
 * The reading has to happen **before** `normalize` in `search.ts` ever sees the
 * text. That function lower-cases and throws punctuation away, and both halves
 * are fatal here: a playlist id is case-sensitive — `PLxA` and `plxa` are two
 * different playlists — and the id lives behind the `?` and `=` it would drop.
 *
 * This module is shared rather than living in `src/`, for the same reason
 * `search.ts` is: the ids it reads are the ids the build writes, and a rule
 * about their shape belongs next to neither half.
 */

import { isPlaylistId } from './playlist-id.js';

export type YoutubeRefKind =
  /** A playlist anybody can open — the only kind the catalogue can contain. */
  | 'playlist'
  /** One recording. The catalogue indexes playlists, so this one is a dead end. */
  | 'video'
  /** A channel, however the address named it: `UC…`, `@handle`, a legacy path. */
  | 'channel'
  /**
   * A list YouTube made for one person: watch later, liked, a mix it generated
   * from something they played. It resolves for nobody else, so it is neither
   * findable here nor worth proposing — which is the whole reason it is told
   * apart from a playlist instead of simply missing.
   */
  | 'personal';

export type YoutubeRef = {
  kind: YoutubeRefKind;
  /** The id as YouTube writes it. Never normalised, never lower-cased. */
  id: string;
  /**
   * Whether this is a playlist the catalogue could hold — one of the three
   * forms `shared/playlist-id.ts` counted over 32 914 crawled rows.
   *
   * Not a condition of finding it: a lookup is `===` against an index that only
   * contains ids the crawl accepted, so a shape nobody issues simply misses.
   * It decides the *offer* instead. `OLAK5uy…` is an auto-generated music
   * album and `FL…` somebody's favourites — real addresses, and proposing them
   * as a course of lectures spends a maintainer's attention on something the
   * pipeline would refuse anyway.
   */
  catalogable?: boolean;
};

/** `youtube.com`, its subdomains, the no-cookie mirror and the short host. */
const HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/;

/** What any id of theirs is made of — base64url, and nothing else. */
const TOKEN = /^[A-Za-z0-9_-]+$/;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/**
 * Lists YouTube generates rather than lists somebody made.
 *
 * `WL` is watch later, `LL`/`LM` liked videos and liked music, `RD…` a mix or
 * radio, `TL…` a temporary list built out of a share, `PU…`/`UL…` the older
 * auto-feeds. None of them mean anything outside the account that produced
 * them.
 */
const PERSONAL_LIST = /^(WL|LM)$|^(LL|RD|TL|PU|UL)/;

/**
 * A bare id, pasted with no address around it.
 *
 * Deliberately narrower than "an id-shaped word": only the prefixes YouTube
 * actually issues for lists, plus a channel id, which has a fixed length and a
 * fixed prefix. **A bare video id is not read as one** — it is eleven
 * characters of base64url, and so is `Probability`. Treating those as links
 * would take a real query out of the search for the sake of a paste nobody
 * makes: a video id reaches the box inside an address, or not at all.
 */
const BARE_LIST = /^(PL|OLAK5uy_|FL|RD|UU|UL|TL|PU|VL)[A-Za-z0-9_-]{10,}$/;

/**
 * What a link names, or `null` when the text is an ordinary query.
 *
 * Returning `null` for anything that is not YouTube is what keeps the search
 * box a search box: «youtube лекции» is a question about the catalogue, not an
 * address, and only text that parses as one of their hosts is treated as one.
 */
export function parseYoutubeRef(raw: string): YoutubeRef | null {
  const text = raw.trim().replace(/^<+|>+$/g, '');
  if (!text) return null;
  const url = asYoutubeUrl(text);
  return url ? fromUrl(url) : fromBareId(text);
}

/** The text as a YouTube address, or `null` — a missing scheme is forgiven. */
function asYoutubeUrl(text: string): URL | null {
  // Anything with a space in it is a query. `new URL` would take «теория чисел»
  // as a host and encode its way to something that parses.
  if (/\s/.test(text)) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    return HOSTS.test(url.hostname.toLowerCase()) ? url : null;
  } catch {
    return null;
  }
}

function fromUrl(url: URL): YoutubeRef | null {
  /*
   * `list=` first, before the path is looked at. It is the same parameter on
   * the playlist page, on a lecture opened out of one and on an embed — and on
   * a `watch?v=…&list=…` it is the more useful half: somebody sharing lecture
   * three of a course is pointing at the course.
   */
  const list = url.searchParams.get('list');
  if (list) {
    const ref = fromListId(list);
    if (ref) return ref;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const [first, second] = segments;

  // youtu.be/<video> — the whole path is the id.
  if (url.hostname.toLowerCase().endsWith('youtu.be')) return video(first);

  if (!first) return null;
  // A handle, and the two paths that predate it. None of them carry a channel
  // id, so the id here is whatever was written — enough to say what the link
  // was, which is all a channel link is used for.
  if (first.startsWith('@')) return { kind: 'channel', id: first };

  switch (first) {
    case 'watch':
      return video(url.searchParams.get('v'));
    // `/embed/videoseries?list=…` has no video in it at all — the `list=` above
    // was the whole address, and reaching here means it was unreadable.
    case 'embed':
    case 'shorts':
    case 'live':
    case 'v':
      return second === 'videoseries' ? null : video(second);
    case 'channel':
      return second && CHANNEL_ID.test(second) ? { kind: 'channel', id: second } : null;
    case 'c':
    case 'user':
      return second ? { kind: 'channel', id: second } : null;
    // `/playlist` with no readable `list=`, `/results?search_query=…`, the front
    // page: an address that names nothing in particular.
    default:
      return null;
  }
}

function fromBareId(text: string): YoutubeRef | null {
  if (/^(WL|LM)$/.test(text)) return { kind: 'personal', id: text };
  if (CHANNEL_ID.test(text)) return { kind: 'channel', id: text };
  return BARE_LIST.test(text) ? fromListId(text) : null;
}

/**
 * One `list=` value, classified.
 *
 * The uploads feed is the case worth spelling out: `UU…` is not a playlist
 * somebody assembled, it is everything a channel has ever published, and its id
 * is the channel's own with two letters changed. So it answers as the channel
 * it is rather than as a playlist the catalogue could be asked for.
 */
function fromListId(raw: string): YoutubeRef | null {
  // `VLPL…` is the browse form of the same list, with a two-letter prefix on it.
  const id = raw.startsWith('VL') ? raw.slice(2) : raw;
  if (!id || !TOKEN.test(id)) return null;
  if (/^UU[A-Za-z0-9_-]{22}$/.test(id)) return { kind: 'channel', id: `UC${id.slice(2)}` };
  if (PERSONAL_LIST.test(id)) return { kind: 'personal', id };
  return { kind: 'playlist', id, catalogable: isPlaylistId(id) };
}

function video(id: string | null | undefined): YoutubeRef | null {
  return id && VIDEO_ID.test(id) ? { kind: 'video', id } : null;
}
