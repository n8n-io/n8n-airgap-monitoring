import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The report destination and the Content-Security-Policy come from the API at runtime, see
// apps/api/src/plugins/config.ts and apps/api/src/content-security-policy.ts.

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: { '/api': 'http://localhost:3456' },
  },
})
