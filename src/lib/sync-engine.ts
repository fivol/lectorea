import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  setDoc,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import type { Profile } from '@shared/schema';
import { track } from '@/lib/analytics';
import { mergeProfiles } from '@/lib/profile-merge';
import {
  CLOUD_LIMIT,
  cleanLinkUrl,
  decideSync,
  isReturning,
  markReturning,
  readCloud,
  readMark,
  rememberedEmail,
  rememberEmail,
  settingsFor,
  writeCloud,
  writeMark,
} from '@/lib/sync';
import { useProfile } from '@/store/profile';
import { useSync, type SyncFault } from '@/store/sync';

/**
 * The half of syncing that talks to Firebase.
 *
 * This module is never in the main bundle: `store/sync.ts` reaches it through
 * `import()`, which is what keeps the SDK out of the download of every reader
 * who never signs in. It is also excluded from the service worker's precache
 * (see `vite.config.ts`), for the same reason — an installed app that quietly
 * pulled 300 KB of authentication code down on first run would have paid the
 * cost anyway.
 *
 * ## What the sync actually is
 *
 * One document per account, holding the profile as one JSON string and a
 * revision counter. A device keeps a mark saying which revision it is standing
 * on and whether it has written anything since (`lib/sync.ts`), and every time
 * the cloud copy is read `decideSync` answers with one of four words:
 *
 * - **push** — the cloud has nothing, or is behind us;
 * - **pull** — the cloud has moved and we have not, so take it wholesale;
 * - **merge** — both sides moved, or this device has never synced this account;
 * - **idle** — nothing to do.
 *
 * The distinction between `pull` and `merge` is the entire point. A merge is a
 * union and so cannot carry an erasure — untick a lecture on a phone and a
 * merge with a laptop that still holds the tick puts it back. A pull can, and
 * a pull is safe exactly when this device has written nothing since. So the
 * union is reserved for two histories that really did diverge, which is the one
 * case where losing an erasure is better than losing the work.
 */

const CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Where a profile lives. The rules allow one document per signed-in reader. */
const COLLECTION = 'profiles';

/**
 * How long a write waits, and how rarely one may happen.
 *
 * The debounce is for a burst — a shift-click over forty lectures is one write.
 * The floor under it is for the player, which reports where the playhead is
 * every five seconds for as long as a lecture runs: without a floor, an
 * afternoon of watching is two thousand writes, and the free tier is twenty
 * thousand a day for everybody together. A minute late is invisible to a
 * reader and is the difference between this costing nothing and costing money.
 */
const PUSH_DEBOUNCE = 4_000;
const PUSH_FLOOR = 60_000;

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

/** The signed-in reader's document, and the listener on it. */
let ref: DocumentReference | undefined;
let unsubscribe: (() => void) | undefined;

/** True while this module is writing to the profile store, so it ignores its own echo. */
let applying = false;
let pushing = false;
/** A snapshot that arrived mid-write, held until the write settles. */
let deferred: unknown | undefined;

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let lastPushAt = 0;
let attached = false;
/** Whether this connection has already had its one `sync_join` counted. */
let joined = false;

function ensure(): { auth: Auth; db: Firestore } {
  if (!app) {
    app = initializeApp(CONFIG);
    auth = getAuth(app);
    db = getFirestore(app);
    watchProfile();
  }
  return { auth: auth!, db: db! };
}

function fault(kind: SyncFault): void {
  useSync.setState({ status: 'error', fault: kind });
  track('sync_error', { kind });
}

/**
 * Which of ours a Firebase error is.
 *
 * Everything unrecognised is `network` rather than `unknown` when it happened
 * during a read or a write, because that is what it almost always is and it is
 * the one failure that resolves itself: the listener reconnects, the mark still
 * says the device is dirty, and the work goes up when the train leaves the
 * tunnel.
 */
function classify(error: unknown, during: 'signin' | 'transfer'): SyncFault {
  const code = String((error as { code?: string })?.code ?? '');
  if (code.includes('popup') || code.includes('cancelled') || code.includes('redirect')) {
    return 'signin';
  }
  if (code.includes('network') || code === 'unavailable' || code.includes('deadline')) {
    return 'network';
  }
  return during === 'signin' ? 'unknown' : 'network';
}

// ---------------------------------------------------------------------------
// Signing in and out
// ---------------------------------------------------------------------------

export async function signIn(): Promise<void> {
  const { auth } = ensure();
  attach();
  const provider = new GoogleAuthProvider();
  // Always ask which account, rather than silently taking the one the browser
  // happens to be signed into. People have a personal Google and a university
  // one, and the profile hangs off whichever this picks.
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    await signInWithPopup(auth, provider);
    track('sync_signin', { kind: 'popup', ok: true });
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? '');
    // Closing the window is an answer, not a failure.
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      useSync.setState({ status: readMark() ? 'connecting' : 'off' });
      return;
    }
    /*
     * A popup is the better sign-in everywhere it is allowed, and it is not
     * allowed in an installed app on iOS, in some in-app browsers, and wherever
     * a blocker is on. The redirect leaves the page and comes back, which is
     * why `markReturning` is set first: the engine has to be loaded again on
     * the way back in, and nothing else on a fresh load would say so.
     */
    if (code === 'auth/popup-blocked' || code.includes('operation-not-supported')) {
      markReturning(true);
      track('sync_signin', { kind: 'redirect', ok: true });
      await signInWithRedirect(auth, provider);
      return;
    }
    markReturning(false);
    fault(classify(error, 'signin'));
    track('sync_signin', { kind: 'popup', ok: false });
  }
}

/**
 * The other way in: a link in an email, and no password anywhere.
 *
 * For readers with no Google account, and for the case Google's popup is worst
 * at — a phone. The letter can be opened on a different device from the one
 * that asked for it, which turns "sign in on my phone" into "press send on the
 * laptop and tap the link on the phone", with nothing typed on the small screen
 * but an address.
 */
export async function sendLink(email: string): Promise<void> {
  const { auth } = ensure();
  attach();
  try {
    await sendSignInLinkToEmail(auth, email, {
      // Back to the page they were reading, not to a landing page of ours.
      // Firebase appends its parameters to this, and `cleanLinkUrl` takes them
      // off again once they have been spent.
      url: `${window.location.origin}${window.location.pathname}`,
      handleCodeInApp: true,
    });
    rememberEmail(email);
    useSync.setState({ pending: { kind: 'sent', email }, fault: null });
    track('sync_signin', { kind: 'email', ok: true });
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? '');
    fault(code.includes('email') ? 'email' : classify(error, 'signin'));
    track('sync_signin', { kind: 'email', ok: false });
  }
}

/** Spend the link, with the address it was sent to. */
export async function finishLink(email: string): Promise<void> {
  const { auth } = ensure();
  useSync.setState({ status: 'connecting', fault: null });
  try {
    await signInWithEmailLink(auth, email, window.location.href);
    rememberEmail(null);
    useSync.setState({ pending: null });
  } catch (error) {
    const code = String((error as { code?: string })?.code ?? '');
    // A link is single-use and expires. Both come back as the same code, and
    // both have the same answer — ask for another one — so they are one fault.
    if (code.includes('action-code') || code.includes('expired')) {
      rememberEmail(null);
      useSync.setState({ pending: null });
      fault('link');
    } else if (code.includes('email')) {
      // Wrong address for this link: keep the field up rather than sending them
      // back to the start, because the next guess is usually the right one.
      fault('email');
    } else {
      fault(classify(error, 'signin'));
    }
  } finally {
    cleanLinkUrl();
  }
}

export async function signOut(): Promise<void> {
  const { auth } = ensure();
  await flush();
  detach();
  writeMark(null);
  markReturning(false);
  rememberEmail(null);
  await firebaseSignOut(auth).catch(() => undefined);
  useSync.setState({ status: 'off', account: null, fault: null, pending: null });
  track('sync_off', { mode: 'signout' });
}

/**
 * Take the cloud copy away and sign out. The profile in this browser stays.
 *
 * The one destructive thing an account can do, and it is deliberately the only
 * way to remove data from the server: there is no other copy, no backup and no
 * tombstone, so a reader who wants their data off this project's infrastructure
 * gets exactly that from one button. Signing out on its own leaves the cloud
 * copy where it is, which is what the other button is for.
 */
export async function forget(): Promise<void> {
  const { auth } = ensure();
  const user = auth.currentUser;
  detach();
  if (user && db) {
    try {
      await deleteDoc(doc(db, COLLECTION, user.uid));
    } catch (error) {
      fault(classify(error, 'transfer'));
      return;
    }
  }
  writeMark(null);
  markReturning(false);
  rememberEmail(null);
  await firebaseSignOut(auth).catch(() => undefined);
  useSync.setState({ status: 'off', account: null, fault: null, pending: null });
  track('sync_off', { mode: 'forget' });
}

// ---------------------------------------------------------------------------
// Staying connected
// ---------------------------------------------------------------------------

/** Start following whoever is signed in. Safe to call more than once. */
export function attach(): void {
  const { auth } = ensure();
  if (attached) return;
  attached = true;

  // The other half of a redirect sign-in. It resolves to `null` on an ordinary
  // load, which is why the flag is cleared either way rather than on success.
  if (isReturning()) {
    void getRedirectResult(auth)
      .catch((error: unknown) => fault(classify(error, 'signin')))
      .finally(() => markReturning(false));
  }

  onAuthStateChanged(auth, (user) => {
    if (user) follow(user);
    else {
      detach();
      useSync.setState({ status: 'off', account: null });
    }
  });

  /*
   * A sign-in link being opened. The address is asked for again — Firebase
   * insists, and rightly: a link is a bearer token, and one intercepted in
   * transit would otherwise be a complete sign-in — so this is a single press
   * when the letter is opened in the browser that asked for it, and a field
   * when it is opened anywhere else, which is the common and intended case.
   */
  if (isSignInWithEmailLink(auth, window.location.href)) {
    const email = rememberedEmail();
    if (email) void finishLink(email);
    else useSync.setState({ status: 'connecting', pending: { kind: 'confirm' } });
  }
}

function follow(user: User): void {
  useSync.setState({
    status: 'connecting',
    fault: null,
    pending: null,
    account: {
      uid: user.uid,
      email: user.email,
      name: user.displayName,
    },
  });

  /*
   * A profile written by a newer build of the site is left alone locally, and
   * it must be left alone in the cloud too — pushing it would translate "this
   * browser cannot read it" into "nobody can". The banner already tells the
   * reader to reload.
   */
  if (useProfile.getState().locked) {
    fault('newer');
    return;
  }

  unsubscribe?.();
  joined = false;
  ref = doc(db!, COLLECTION, user.uid);
  unsubscribe = onSnapshot(
    ref,
    (snapshot) => {
      // Our own write, before the server has confirmed it: nothing new in it.
      if (snapshot.metadata.hasPendingWrites) return;
      if (pushing) {
        deferred = snapshot.data() ?? null;
        return;
      }
      reconcile(user.uid, snapshot.data() ?? null);
    },
    (error: unknown) => fault(classify(error, 'transfer'))
  );
}

function detach(): void {
  unsubscribe?.();
  unsubscribe = undefined;
  ref = undefined;
  cancelPush();
}

/** One round of "what does the cloud say, and what should happen about it". */
function reconcile(uid: string, raw: unknown): void {
  const cloud = readCloud(raw);
  if (cloud.kind === 'newer') {
    fault('newer');
    return;
  }

  const mark = readMark();
  const linked = mark?.uid === uid;
  /*
   * The server confirming a write of ours, rather than news from another
   * device: same account, same revision this device already recorded pushing.
   *
   * Worth naming, because without it the sync writes in a loop. A push is
   * answered by a snapshot, the snapshot is reconciled, and a reader who is
   * still watching a lecture is still dirty — so the reconciliation decides to
   * push, is answered by a snapshot, and round it goes, at whatever rate
   * Firestore can confirm rather than at the one write a minute the floor is
   * there to enforce. An echo hands the work back to `schedulePush`, which is
   * the only thing that knows how long a write has to wait.
   */
  const echo = linked && cloud.kind === 'ok' && cloud.rev === mark!.rev;
  const decision = decideSync({
    linked,
    localRev: linked ? mark!.rev : 0,
    dirty: linked ? mark!.dirty : true,
    // Absent and unreadable are the same answer — there is nothing up there to
    // move towards. A document nobody can read is a document to overwrite: the
    // reader's own profile is right here, whole, and the alternative is an
    // account that can never be written to again.
    remoteRev: cloud.kind === 'ok' ? cloud.rev : null,
  });

  // One per connection: what is worth knowing is how a device and a cloud copy
  // met, not how many times a running session confirmed itself.
  if (!joined) {
    joined = true;
    track('sync_join', { mode: decision, kind: linked ? 'linked' : 'first' });
  }

  if (decision === 'idle') {
    useSync.setState({ status: 'synced', fault: null });
    return;
  }

  if (cloud.kind === 'ok' && (decision === 'pull' || decision === 'merge')) {
    const local = useProfile.getState().profile;
    const merged = decision === 'pull' ? cloud.profile : mergeProfiles(local, cloud.profile);
    apply({ ...merged, settings: settingsFor(local, cloud.profile) });
    writeMark({ uid, rev: cloud.rev, dirty: decision === 'merge' });
    if (decision === 'pull') {
      useSync.setState({ status: 'synced', fault: null });
      return;
    }
  } else {
    writeMark({ uid, rev: mark?.uid === uid ? mark.rev : 0, dirty: true });
  }

  // `merge` and `push` both end with this device's profile going up — a merge
  // at once, because it has just materialised a state nothing else holds, and
  // an echo on the ordinary schedule.
  if (echo && decision === 'push') schedulePush();
  else void push(uid);
}

/** Write a profile into the store without it looking like a reader's own edit. */
function apply(next: Profile): void {
  applying = true;
  try {
    useProfile.getState().applyRemote(next);
  } finally {
    applying = false;
  }
}

// ---------------------------------------------------------------------------
// Getting local work up
// ---------------------------------------------------------------------------

function watchProfile(): void {
  useProfile.subscribe((state, previous) => {
    if (applying || state.profile === previous.profile) return;
    const mark = readMark();
    if (!mark) return;
    if (!mark.dirty) writeMark({ ...mark, dirty: true });
    schedulePush();
  });

  /*
   * A tab being closed or put away is the last chance to get the afternoon up,
   * and it is the common one: people finish a lecture and shut the laptop.
   * `pagehide` fires where `beforeunload` does not — an installed app on iOS
   * being swiped away — and `visibilitychange` catches the phone going in a
   * pocket, which is the same event as far as this is concerned.
   */
  const leaving = (): void => {
    if (document.visibilityState === 'hidden') void flush();
  };
  document.addEventListener('visibilitychange', leaving);
  window.addEventListener('pagehide', () => void flush());
}

function cancelPush(): void {
  clearTimeout(pushTimer);
  pushTimer = undefined;
}

function schedulePush(): void {
  if (!ref) return;
  cancelPush();
  const wait = Math.max(PUSH_DEBOUNCE, PUSH_FLOOR - (Date.now() - lastPushAt));
  pushTimer = setTimeout(() => void push(), wait);
}

/** Everything waiting, now — for a tab that is about to stop existing. */
async function flush(): Promise<void> {
  if (!pushTimer) return;
  cancelPush();
  await push();
}

async function push(uid?: string): Promise<void> {
  const owner = uid ?? auth?.currentUser?.uid;
  if (!ref || !owner || pushing) return;

  const mark = readMark();
  const profile = useProfile.getState().profile;
  const rev = (mark?.uid === owner ? mark.rev : 0) + 1;
  const payload = writeCloud(profile, rev);

  /*
   * One document is a megabyte and a profile is a long way from it — a decade
   * of daily study is a few hundred kilobytes. But "a long way from it" is not
   * "cannot", and the failure to avoid is the silent one: the write is refused
   * by the server, the mark still says clean, and the reader believes they have
   * a backup. Better to stop, say so, and keep the local profile working.
   */
  if (payload.data.length > CLOUD_LIMIT) {
    fault('too-big');
    return;
  }

  pushing = true;
  useSync.setState({ status: 'working' });
  cancelPush();
  try {
    await setDoc(ref, payload);
    lastPushAt = Date.now();
    /*
     * Anything written while this was in flight leaves the device dirty, and
     * the next write picks it up: the profile object is replaced on every edit,
     * so identity is the whole check.
     *
     * The status still says synced. A lecture that has been playing for two
     * minutes has moved the profile since the write went out, and it will do
     * so again in five seconds — a spinner that is on for the length of every
     * lecture says nothing except that a lecture is playing. `working` is for a
     * write actually in flight; the minute the floor holds a playhead back is
     * not a state anybody needs told about.
     */
    const moved = useProfile.getState().profile !== profile;
    writeMark({ uid: owner, rev, dirty: moved });
    useSync.setState({ status: 'synced', fault: null });
    if (moved) schedulePush();
  } catch (error) {
    fault(classify(error, 'transfer'));
  } finally {
    pushing = false;
    if (deferred !== undefined) {
      const held = deferred;
      deferred = undefined;
      reconcile(owner, held);
    }
  }
}
