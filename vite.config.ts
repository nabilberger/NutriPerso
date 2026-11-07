import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure(proxy) {
          const eventProxy = proxy as unknown as { on: (event: 'error', listener: (error: unknown, request: unknown, response: unknown) => void) => void }
          eventProxy.on('error', (_error, _request, response) => {
            if (typeof response !== 'object' || response === null) return
            const writable = response as { headersSent?: boolean; writeHead?: (status: number, headers: Record<string, string>) => void; end?: (body: string) => void }
            if (writable.headersSent || typeof writable.writeHead !== 'function' || typeof writable.end !== 'function') return
            writable.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
            writable.end('API locale indisponible. Lancez npm run dev:stack, ou npm run dev:fixtures pour la recette UI synthétique.')
          })
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'NutriPerso',
        short_name: 'NutriPerso',
        description: 'Votre espace personnel de suivi nutritionnel.',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#f7f8f4',
        theme_color: '#f7f8f4',
        icons: [
          { src: '/nutriperso-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/nutriperso-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
    }),
  ],
})
