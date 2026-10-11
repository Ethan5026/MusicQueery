import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'nogit'
  }
}

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(`${gitSha()}·${new Date().toISOString().slice(5, 16).replace('T', ' ')}`),
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'https://musicqueery.ethangruening.workers.dev', changeOrigin: true } },
  },
  // Never inline scripts as data: URLs; the AudioWorklet module must load from our origin.
  build: { assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'MusicQueery',
        short_name: 'MusicQueery',
        description: 'Live lead sheet synced to Spotify',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#090c11',
        theme_color: '#090c11',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // Eruda (the on-device console, ?debug) loads only on demand; keep it out of the offline cache.
        globIgnores: ['**/eruda-*.js'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
