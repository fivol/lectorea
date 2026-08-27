import { migrateProfile, PROFILE_VERSION, ProfileSchema, type Profile } from '@shared/schema';

/**
 * The rules of syncing, with no Firebase in them.
 *
 * Everything here is a pure function or one localStorage key, so the decision
 * that can lose somebody's year of marks is testable without a network, an
 * account or a browser — see `tests/sync.test.ts`. The engine that talks to
 * Firestore is `lib/sync-engine.ts`, and it is loaded only for readers who have
 * actually signed in.
 */

/** Where this device records which revision of the cloud copy it is standing on. */
export const SYNC_KEY = 'catalog.sync.v1';

/**
 * What this device knows about the cloud copy.
 *
 * `rev` is the cloud's own counter, not a clock: two devices writing in the
 * same second still get different numbers, and comparing numbers needs no
 * agreement about time zones or about whose clock is right.
 *
 * `dirty` is the whole reason the mark exists. Without it a device coming back
 * online cannot tell "I have work the cloud has not seen" from "the cloud has
 * moved on without me", and those two need opposite answers.
 */
export type SyncMark = {
  uid: string;
  rev: number;
  dirty: boolean;
};

export function readMark(): SyncMark | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SYNC_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncMark>;
    if (typeof parsed?.uid !== 'string' || !parsed.uid) return null;
    return {
      uid: parsed.uid,
      rev: typeof parsed.rev === 'number' ? parsed.rev : 0,
      dirty: parsed.dirty !== false,
    };
  } catch {
    return null;
  }
}

export function writeMark(mark: SyncMark | null): void {
  try {
    if (mark) localStorage.setItem(SYNC_KEY, JSON.stringify(mark));
    else localStorage.removeItem(SYNC_KEY);
  } catch {
    // Private mode. The session still syncs; it simply re-merges next time,
    // which the merge is built to survive.
  }
}

export type SyncDecision = 'push' | 'pull' | 'merge' | 'idle';

/**
 * What to do when the cloud copy has just been read.
 *
 * The shape is git's, and for git's reason: a merge is the expensive answer and
 * should only be given when the two sides have genuinely both moved. Everywhere
 * else one side is simply ahead, and moving the other one forward wholesale is
 * both cheaper and *more correct* — a fast-forward carries erasures, and a
 * union merge cannot (see `mergeProfiles`). Unticking a lecture on the phone
 * has to reach the laptop, and this is the line that lets it.
 *
 * - `linked` — this device has synced with this account before. A device that
 *   has not is one of two histories meeting for the first time, and that is
 *   always a merge, whatever the numbers say.
 * - `dirty` — the profile has been written since the revision in the mark.
 */
export function decideSync(input: {
  linked: boolean;
  localRev: number;
  dirty: boolean;
  /** `null` when the account has no cloud copy yet. */
  remoteRev: number | null;
}): SyncDecision {
  const { linked, localRev, dirty, remoteRev } = input;
  if (remoteRev === null) return 'push';
  if (!linked) return 'merge';
  if (remoteRev > localRev) return dirty ? 'merge' : 'pull';
  // Behind us: the cloud copy was deleted and started again while this device
  // was away. Ours is the longer history, so it goes up.
  if (remoteRev < localRev) return 'push';
  return dirty ? 'push' : 'idle';
}

/**
 * Whose settings survive an apply, and the one that never travels.
 *
 * Settings are part of the profile and people expect a goal set on the laptop
 * to be the goal on the phone, so the newer profile's win wholesale rather than
 * field by field — a per-field merge of a theme and a playback speed is a
 * reconciliation problem with no right answer and no way to explain it.
 *
 * `splitRatio` is the exception because it is not a preference at all: it is
 * where the drag handle sits between the columns and the panel, measured
 * against one screen. A 27-inch monitor's split arriving on a laptop is a panel
 * off the edge, so it stays where it was measured.
 */
export function settingsFor(local: Profile, incoming: Profile): Profile['settings'] {
  const winner = incoming.updatedAt > local.updatedAt ? incoming.settings : local.settings;
  return { ...winner, splitRatio: local.settings.splitRatio };
}

/**
 * The cloud copy, as it is stored.
 *
 * The profile travels as one JSON string rather than as a Firestore map, and
 * the reason is not tidiness: a map is indexed, and a reader with three
 * thousand ticked lectures is a map with three thousand keys — well past the
 * index entries one document is allowed. A string is opaque, costs one write
 * whatever is in it, and is the same bytes the export button already produces.
 */
export type CloudProfile = {
  rev: number;
  /** `PROFILE_VERSION` of the build that wrote it. */
  version: number;
  updatedAt: string;
  data: string;
};

/** Firestore's ceiling on one document is 1 MiB; this leaves room for the rest of it. */
export const CLOUD_LIMIT = 900_000;

export type CloudRead =
  | { kind: 'empty' }
  | { kind: 'ok'; rev: number; profile: Profile }
  /** Written by a newer build of the site. Not ours to read, and not ours to overwrite. */
  | { kind: 'newer'; rev: number }
  | { kind: 'corrupt'; rev: number };

export function readCloud(raw: unknown): CloudRead {
  if (!raw || typeof raw !== 'object') return { kind: 'empty' };
  const doc = raw as Partial<CloudProfile>;
  const rev = typeof doc.rev === 'number' ? doc.rev : 0;
  if (typeof doc.version === 'number' && doc.version > PROFILE_VERSION) return { kind: 'newer', rev };
  if (typeof doc.data !== 'string') return { kind: 'corrupt', rev };

  let parsed: unknown;
  try {
    parsed = JSON.parse(doc.data);
  } catch {
    return { kind: 'corrupt', rev };
  }
  const result = ProfileSchema.safeParse(migrateProfile(parsed));
  return result.success ? { kind: 'ok', rev, profile: result.data } : { kind: 'corrupt', rev };
}

export function writeCloud(profile: Profile, rev: number): CloudProfile {
  return {
    rev,
    version: PROFILE_VERSION,
    updatedAt: profile.updatedAt,
    data: JSON.stringify(profile),
  };
}

/**
 * A sign-in that left the page and is expected back.
 *
 * `signInWithRedirect` navigates away and returns to a fresh load of the site,
 * where nothing yet says an account is involved — the mark is only written once
 * a sync has actually happened. Without this key the reader comes back signed
 * in as far as Firebase is concerned and signed out as far as the page is
 * concerned, because the engine that would notice is never loaded.
 */
const RETURNING_KEY = 'catalog.sync.returning';

export function markReturning(on: boolean): void {
  try {
    if (on) localStorage.setItem(RETURNING_KEY, '1');
    else localStorage.removeItem(RETURNING_KEY);
  } catch {
    // Then the reader presses «Войти» once more, which works.
  }
}

export function isReturning(): boolean {
  try {
    return localStorage.getItem(RETURNING_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The address a sign-in link was sent to, kept until the link is opened.
 *
 * Firebase requires the address again when the link is used, and will not take
 * it out of the link itself: a link is a bearer token, and one intercepted in
 * transit would otherwise be a complete sign-in. Remembering it here is what
 * makes the ordinary case — send from this browser, open the letter in this
 * browser — a single press. Opening it anywhere else asks for the address, and
 * that is the check working rather than failing.
 */
const EMAIL_KEY = 'catalog.sync.email';

export function rememberEmail(email: string | null): void {
  try {
    if (email) localStorage.setItem(EMAIL_KEY, email);
    else localStorage.removeItem(EMAIL_KEY);
  } catch {
    // Then the link asks for the address on the way back, which is the same
    // path a link opened on another device takes anyway.
  }
}

export function rememberedEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_KEY);
  } catch {
    return null;
  }
}

/**
 * Whether this address is Firebase handing a sign-in link back.
 *
 * Asked before the SDK is loaded, and answered without it, because the whole
 * point of the lazy import is that nothing downloads it speculatively — and a
 * link opened on a phone that has never seen this site has no mark and no
 * returning flag to go on. `mode=signIn` with an `oobCode` is what the handler
 * appends, and nothing else on this site uses either name.
 */
export function looksLikeEmailLink(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get('mode') === 'signIn' && Boolean(params.get('oobCode'));
}

/** The parameters Firebase appends, which have no business outliving the sign-in. */
const LINK_PARAMS = ['apiKey', 'oobCode', 'mode', 'lang', 'continueUrl', 'tenantId'];

/**
 * Take the sign-in link's parameters out of the address bar.
 *
 * Not for tidiness: an `oobCode` in the address is a credential in the address,
 * and an address is the thing people copy, bookmark and paste into a chat. It
 * never reaches the analytics — `pageView` builds its path out of catalogue ids
 * and rebuilds the query from an allowlist — but a reader can still hand it to
 * somebody by accident, and there is no reason for it to be there once used.
 *
 * `replaceState` rather than a navigation: none of these names is read by any
 * screen, so there is nothing to re-render and no history entry to add.
 */
export function cleanLinkUrl(): void {
  const url = new URL(window.location.href);
  if (!LINK_PARAMS.some((name) => url.searchParams.has(name))) return;
  for (const name of LINK_PARAMS) url.searchParams.delete(name);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
