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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
