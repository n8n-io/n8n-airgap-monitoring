import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * Where the data goes, from the build environment so the URL is not in the repository. Fixed once
 * built, so the person submitting cannot change it. Unset, the page builds but cannot submit.
 */
const SUBMIT_ENDPOINT = process.env.VITE_SUBMIT_ENDPOINT?.trim() || null

/** The built page may only talk to this service and to the n8n endpoint. */
function contentSecurityPolicy(): Plugin {
  const connectSrc = SUBMIT_ENDPOINT === null ? "'self'" : `'self' ${new URL(SUBMIT_ENDPOINT).origin}`
  const policy = [
    "default-src 'self'",
    `connect-src ${connectSrc}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')

  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
    ],
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Served by the API under /submit/, see apps/api/src/app.ts.
  base: '/submit/',
  plugins: [vue(), contentSecurityPolicy()],
  define: {
    __SUBMIT_ENDPOINT__: JSON.stringify(SUBMIT_ENDPOINT),
  },
  server: {
    proxy: { '/api': 'http://localhost:3456' },
  },
})
