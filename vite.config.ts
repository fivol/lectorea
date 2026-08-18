import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// The catalogue lives at the root of its own domain, but a fork without one is
// served from /<repo>/ on github.io, so a built bundle has to be told which of
// the two it is. Dev keeps the short root URL; everything that builds a runtime
// path reads `import.meta.env.BASE_URL`, which follows this setting on its own.
/**
 * Which repository this build belongs to, as `owner/repo`. Two things follow
 * from it — the subdirectory Pages serves a project site from, and where the
 * "suggest a playlist" and "fix this entry" links go — so it is stated once.
 * CI passes it in from GitHub's own context, which is why a fork gets its own
 * links without editing anything; the default is only for a bare checkout.
 */
const repo = process.env.VITE_REPO ?? 'fivol/lectorea';

/**
 * A custom domain serves the site from the root instead of /<repo>/. CI hands
 * this over as an empty string for a fork, which has no domain of its own —
 * hence `||`, which falls back on empty, and not `??`, which would not.
 */
const basePath = process.env.BASE_PATH || `/${repo.split('/')[1]}/`;

/**
 * The GA4 stream this build reports to, and whether a development build is
 * allowed to report at all.
 *
 * Empty is the meaningful default rather than an oversight: a fork, a checkout
 * and every `pnpm dev` then send nothing at all, and only the deploy that is
 * handed the id in its environment counts anything. Passed the same way
 * `VITE_REPO` is, so CI needs no file on disk — docs/analytics.md.
 */
const ga4Id = process.env.VITE_GA4_ID ?? '';
const ga4Debug = process.env.VITE_GA4_DEBUG ?? '';

/**
 * Restart the dev server when the styling config changes.
 *
 * Vite reloads its own config on the spot, but PostCSS reads
 * `tailwind.config.js` once and the running server then rebuilds CSS from the
 * copy it started with. What that looks like is worse than a change not
 * arriving: new utility classes written in a component *do* appear, so the page
 * updates — while the palette behaves by the old rules, and a class the new
 * config would have generated is silently absent from the stylesheet. A whole
 * afternoon can go into a component that was correct on disk the entire time.
 *
 * `server.restart()` is what the same edit to `vite.config.ts` already gets.
 * Dev only — a build reads both files once anyway.
 */
const restartOnStyleConfig = {
  name: 'restart-on-style-config',
  configureServer(server: import('vite').ViteDevServer) {
    const watched = ['tailwind.config.js', 'postcss.config.js'];
    server.watcher.add(watched.map((file) => fileURLToPath(new URL(`./${file}`, import.meta.url))));
    server.watcher.on('change', (file) => {
      if (watched.some((name) => file.endsWith(name))) void server.restart();
    });
  },
};

// Keyed on mode rather than command so that `vite preview` — which serves a
// production build but still counts as `serve` — shows the site exactly as
// Pages will. Only the dev server stays at the root.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? basePath : '/',

  // Injected rather than left to .env discovery, so that passing VITE_REPO in
  // the environment is enough and CI needs no file on disk.
  define: {
    'import.meta.env.VITE_REPO': JSON.stringify(repo),
    'import.meta.env.VITE_GA4_ID': JSON.stringify(ga4Id),
    'import.meta.env.VITE_GA4_DEBUG': JSON.stringify(ga4Debug),
  },

  plugins: [
    react(),
    restartOnStyleConfig,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['map.svg', 'images/**/*', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Lectorea',
        short_name: 'Lectorea',
        description: 'Каталог образовательных плейлистов в порядке изучения',
        // The canvas colour from src/index.css, so the shell around an
        // installed window is the page's own background rather than a near
        // miss of it.
        theme_color: '#0B0F17',
        background_color: '#0B0F17',
        display: 'standalone',
        // No `start_url` or `scope`: the plugin derives both from `base`, and
        // a hardcoded '/' would install a shortcut to the wrong site.
        // Two shapes of the same mark: the rounded tile for platforms that
        // show an icon as it is, and a full-bleed one for Android, which
        // crops every icon to its own shape and would otherwise cut the
        // corners off the tile.
        // Relative sources: the browser resolves them against the manifest's
        // own URL, so they land in the subdirectory without repeating it here.
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Generated data is static between deploys — cache it whole.
        globPatterns: ['**/*.{js,css,html,svg,woff2,webp,png}'],
        runtimeCaching: [
          {
            urlPattern: /\/data\/.*\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'catalog-data' },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
}));
