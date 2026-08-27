/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The repository the catalogue lives in, as `owner/repo`. Fixed at build
   * time from VITE_REPO — see vite.config.ts.
   */
  readonly VITE_REPO: string;
  /**
   * The GA4 web stream events are reported to, as `G-XXXXXXXXXX`. Absent in a
   * fork, in a local checkout and in `pnpm dev`, and the site is then silent —
   * see `src/lib/analytics.ts` and docs/analytics.md.
   */
  readonly VITE_GA4_ID: string;
  /** `1` sends from a development build too, marked as debug. Off by default. */
  readonly VITE_GA4_DEBUG: string;
  /*
   * The Firebase project the optional sync account lives in. All four are empty
   * in a fork and in a local checkout, and the sync section then does not exist
   * — see `src/store/sync.ts` and docs/sync.md. None of them is a secret: a web
   * config ships inside the bundle by construction, and what protects a profile
   * is the security rule in `firebase/firestore.rules`, not the key.
   */
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
