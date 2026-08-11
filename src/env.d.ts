/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The repository the catalogue lives in, as `owner/repo`. Fixed at build
   * time from VITE_REPO — see vite.config.ts.
   */
  readonly VITE_REPO: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
