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
    },
  },
})