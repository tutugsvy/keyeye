import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/argus': {
        target: 'https://argus.world',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/argus/, '/api/tokens'),
      },
    },
  },
})
