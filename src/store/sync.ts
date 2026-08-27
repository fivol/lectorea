import { create } from 'zustand';
import { isReturning, readMark } from '@/lib/sync';

/**
 * What the interface knows about syncing, and nothing that Firebase knows.
 *
 * The Firebase SDK is 300 KB of JavaScript that a reader who never signs in
 * must never download, so it lives behind a dynamic import in
 * `lib/sync-engine.ts` and this store is the only thing the screens talk to.
 * Everything here works — as `off` — in a build with no Firebase configured at
 * all, which is what a fork of this repository gets.
 */

/** The build carries a Firebase project, so the sync section exists. */
export const SYNC_AVAILABLE = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID
);

export type SyncStatus =
  /** No account: the profile is in this browser and nowhere else. */
  | 'off'
  /** Loading the engine, or waiting for the first answer from the cloud. */
  | 'connecting'
  /** Signed in, and the cloud copy and this device agree. */
  | 'synced'
  /** Signed in, with something on its way up or down. */
  | 'working'
  | 'error';

/**
 * What went wrong, as something the interface can put into words.
 *
 * A code rather than the SDK's message: the message is English, untranslated
 * and occasionally a stack trace, and a reader who cannot sign in needs to know
 * which of four different things to do about it.
 */
export type SyncFault =
  /** Offline, or the request never arrived. Nothing is lost; it retries. */
  | 'network'
  /** The sign-in window was blocked or closed. */
  | 'signin'
  /** The cloud copy was written by a newer build of the site. */
  | 'newer'
  /** The profile has outgrown what one document may hold. */
  | 'too-big'
  | 'unknown';

/**
 * Who is signed in, in the two fields the interface shows.
 *
 * No avatar URL on purpose: it would be the only request this site makes to a
 * third party for a picture, on a screen whose whole argument is that nothing
 * about a reader leaves the browser. An initial in the accent disc says the
 * same thing and costs nothing.
 */
export type SyncAccount = {
  uid: string;
  email: string | null;
  name: string | null;
};

type SyncStore = {
  status: SyncStatus;
  account: SyncAccount | null;
  fault: SyncFault | null;
  /** An action the reader pressed is still running — the buttons wait for it. */
  busy: boolean;
  signIn: () => void;
  signOut: () => void;
  /** Sign out **and** delete the cloud copy. The local profile is untouched. */
  forget: () => void;
};

/**
 * The engine, once. Every action loads it on demand and they all get the same
 * module — a second `import()` of a chunk already in memory is free.
 */
async function engine() {
  return import('@/lib/sync-engine');
}

async function run(action: (mod: Awaited<ReturnType<typeof engine>>) => Promise<void>) {
  useSync.setState({ busy: true, fault: null });
  try {
    await action(await engine());
  } finally {
    useSync.setState({ busy: false });
  }
}

export const useSync = create<SyncStore>(() => ({
  status: 'off',
  account: null,
  fault: null,
  busy: false,

  signIn: () => void run((mod) => mod.signIn()),
  signOut: () => void run((mod) => mod.signOut()),
  forget: () => void run((mod) => mod.forget()),
}));

/**
 * Reconnect a reader who is already signed in, before they ask for anything.
 *
 * Called once at boot, and it loads nothing at all unless this browser has
 * synced before or has just come back from a sign-in redirect. That is the
 * whole of what keeps the catalogue's payload the same for everybody else.
 */
export function bootSync(): void {
  if (!SYNC_AVAILABLE) return;
  if (!readMark() && !isReturning()) return;
  useSync.setState({ status: 'connecting' });
  void engine().then((mod) => mod.attach());
}
