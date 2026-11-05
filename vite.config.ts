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
          proxy.on('error', (_error, _request, response) => {
            if (!('writeHead' in response) || response.headersSent) return
            response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
            response.end('API locale indisponible. Lancez npm run dev:stack, ou npm run dev:fixtures pour la recette UI synthétique.')
          })
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
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
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
})
