import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/__proxy_sharesight': {
        target: 'https://api.sharesight.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__proxy_sharesight/, ''),
      },
      '/api/market/batch': {
        target: 'http://127.0.0.1:8790',
        changeOrigin: true,
        rewrite: () => '/market/batch',
      },
      '/api/analysis/triad': {
        target: 'http://127.0.0.1:8791',
        changeOrigin: true,
        rewrite: () => '/analysis/triad',
      },
    },
  },
})