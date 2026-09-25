/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteSingleFile } from 'vite-plugin-singlefile'
import pkg from './package.json' with { type: 'json' }

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url))

/**
 * `npm run build:single` makes one self-contained index.html (no service worker,
 * pdf.js on the main thread) that can be opened or shared as a single file for quick tries.
 */
function singleFileSwaps(): Plugin {
  return {
    name: 'notlarim-single-file-swaps',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'virtual:pwa-register/react') return src('pwa-stub.ts')
      if (source === './worker' && importer?.replace(/\\/g, '/').endsWith('src/pdf/pdf.ts')) return src('pdf/worker.single.ts')
      return null
    },
  }
}

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: mode === 'single' ? { outDir: 'dist-single', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 10_000 } : undefined,
  plugins: mode === 'single' ? [singleFileSwaps(), react(), viteSingleFile()] : [
    react(),
    VitePWA({
      // "prompt": a new version waits until the user taps "Yenile", it never reloads mid-note.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'notlarım',
        short_name: 'notlarım',
        description: 'iPad ve Apple Pencil için yazılı ve çizimli notlar. Her şey cihazda saklanır.',
        lang: 'tr',
        theme_color: '#FBEAF0',
        background_color: '#FBEAF0',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        // Turkish only needs the latin + latin-ext font subsets.
        globIgnores: ['**/*cyrillic*', '**/*greek*', '**/*vietnamese*', '**/*hebrew*', '**/*math*', '**/*symbols*'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // The large ONNX/WASM runtime stays lazy, then becomes available offline after first use.
        // Hugging Face model weights use Transformers.js' own Cache API cache and are never precached here.
        runtimeCaching: [
          {
            urlPattern: /\/assets\/ort-.*\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'transcription-runtime',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
