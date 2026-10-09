import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { parseArgs } from 'node:util'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

/**
 * The report given as `pnpm inspect --file=<report.json>`. The `inspect` script ends in `--`,
 * so Vite's CLI leaves the flag alone. A relative path is resolved from where the command was
 * typed (INIT_CWD), not from apps/dashboard, where pnpm runs it.
 */
function reportFile(): string | undefined {
  const separator = process.argv.indexOf('--')
  const { values } = parseArgs({
    args: separator === -1 ? [] : process.argv.slice(separator + 1),
    options: { file: { type: 'string' } },
    strict: false,
  })
  if (typeof values.file !== 'string') {
    return undefined
  }

  const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), values.file)
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Not a file: ${file}`)
  }
  return file
}

/** Streams the report file as-is, so the dev server never parses or holds it. */
function serveReport(file: string | undefined): Plugin {
  return {
    name: 'serve-report',
    configureServer(server) {
      if (file !== undefined) {
        server.config.logger.info(`Inspecting ${file}`)
      }
      server.middlewares.use('/report.json', (_req, res) => {
        if (file === undefined) {
          res.statusCode = 404
          res.end('Start with `pnpm inspect --file=<report.json>`.')
          return
        }
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        createReadStream(file).pipe(res)
      })
    },
  }
}

// https://vite.dev/config/
// Vite binds to localhost only, so a report is never exposed on the network.
export default defineConfig({
  plugins: [vue(), vueDevTools(), serveReport(reportFile())],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
