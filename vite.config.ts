import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
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
        start_url: '/',
        // Two shapes of the same mark: the rounded tile for platforms that
        // show an icon as it is, and a full-bleed one for Android, which
        // crops every icon to its own shape and would otherwise cut the
        // corners off the tile.
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512.png',
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
});
