import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig(({ mode }) => {
  const plugins: PluginOption[] = [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Ledgr',
        short_name: 'Ledgr',
        description: 'Smart accounting for Malawian SMEs',
        theme_color: '#16a34a',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // Safety net: minifier output size varies between environments (local
        // vs CI), and a chunk creeping past workbox's 2 MiB default makes the
        // build hard-fail. 5 MiB keeps the app fully precachable/offline while
        // still flagging genuinely runaway bundles via chunkSizeWarningLimit.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname === 'hsuhuvuxfuufrlejsatw.supabase.co' &&
              url.pathname.startsWith('/rest/v1/'),
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'ledgr-api-cache',
              networkTimeoutSeconds: 4,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.hostname === 'hsuhuvuxfuufrlejsatw.supabase.co' &&
              url.pathname.startsWith('/auth/v1/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ request }) =>
              request.destination === 'image' || request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'ledgr-static-assets',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ];

  // Upload source maps to Sentry in CI so production stack traces are readable.
  // Guarded by SENTRY_AUTH_TOKEN so local/dev builds skip it entirely and the
  // @sentry/vite-plugin dependency is never required to produce a build.
  if (process.env.SENTRY_AUTH_TOKEN) {
    plugins.push(
      sentryVitePlugin({
        org: process.env.SENTRY_ORG || '',
        project: process.env.SENTRY_PROJECT || '',
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: process.env.VITE_APP_VERSION || mode },
      }),
    );
  }

  return {
    plugins,
    define: {
      // Stable release tag for Sentry (git sha in CI, otherwise a local stamp).
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(
        process.env.VITE_APP_VERSION || `local-${new Date().toISOString()}`,
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          // Keep the shared vendor code out of the entry chunk. Pages are
          // already lazy-loaded, so this mainly stops React + router + query +
          // i18n + Dexie from bloating the one file every visitor must fetch.
          advancedChunks: {
            groups: [
              {
                name: 'vendor-react',
                test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/,
                priority: 30,
              },
              {
                name: 'vendor-charts',
                test: /node_modules[\\/](recharts|d3-.*|victory-.*|internmap|decimal\.js-light)[\\/]/,
                priority: 25,
              },
              {
                name: 'vendor-data',
                test: /node_modules[\\/](@supabase|@tanstack|dexie|dexie-react-hooks)[\\/]/,
                priority: 20,
              },
              {
                name: 'vendor-i18n',
                test: /node_modules[\\/](i18next.*|react-i18next)[\\/]/,
                priority: 15,
              },
              {
                name: 'vendor',
                test: /node_modules[\\/]/,
                priority: 1,
              },
            ],
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      hmr: {
        clientPort: 443,
      },
    },
  };
});
