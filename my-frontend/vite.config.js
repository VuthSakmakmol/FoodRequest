// vite.config.js
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // ✅ add proxy so /api goes to backend 4333
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4333',
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: 'http://localhost:4333',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})