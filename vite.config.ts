import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['map.svg', 'images/**/*'],
      manifest: {
        name: 'Lectorea',
        short_name: 'Lectorea',
        description: 'Каталог образовательных плейлистов в порядке изучения',
        theme_color: '#0B0F1A',
        background_color: '#0B0F1A',
        display: 'standalone',
        start_url: '/',
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
