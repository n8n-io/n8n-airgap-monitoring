import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type FastifyPluginAsync } from 'fastify'
import { CLIENT_SCRIPT_PATH, renderDashboardPage, renderInstanceRows } from './dashboard.view'

const PAGE_SIZE = 25

// Where tsconfig.client.json emits the compiled ./dashboard.client.ts. Walked
// from the repository root rather than __dirname directly, because this module
// runs from dist/routes/dashboard in production and from src/routes/dashboard
// under tsx in tests — both sit three levels below the root, so one relative
// walk covers both and tests exercise the same bundle that ships.
const CLIENT_SCRIPT_FILE = join(__dirname, '..', '..', '..', 'dist', 'public', 'dashboard.client.js')

// Same reasoning as the JSON API (see ../api/v1/instances): the app-wide Ajv
// config disables type coercion, so a numeric query param is validated as a
// digit-string pattern and parsed by hand.
const POSITIVE_INTEGER_STRING = { type: 'string', pattern: '^[1-9][0-9]*$' } as const

const rowsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['cursor'],
  properties: {
    cursor: POSITIVE_INTEGER_STRING,
    // The metric columns already on screen, in display order. Sent by the
    // client so appended rows line up with a header the server can't see.
    columns: { type: 'string', maxLength: 4096 }
  }
}

const rowsResponseSchema = {
  type: 'object',
  required: ['rowsHtml', 'newColumns', 'nextCursor'],
  properties: {
    rowsHtml: { type: 'string' },
    newColumns: { type: 'array', items: { type: 'string' } },
    nextCursor: { type: ['integer', 'null'] }
  }
}

function parseColumns (columns: string | undefined): string[] {
  return columns === undefined || columns === '' ? [] : columns.split(',')
}

/** Read once at startup: the bundle is small and never changes while running. */
async function readClientScript (): Promise<string> {
  try {
    return await readFile(CLIENT_SCRIPT_FILE, 'utf8')
  } catch (cause) {
    throw new Error(
      `Dashboard client bundle is missing at ${CLIENT_SCRIPT_FILE}. Run \`pnpm build:ts\` first.`,
      { cause }
    )
  }
}

const dashboard: FastifyPluginAsync = async (fastify): Promise<void> => {
  const clientScript = await readClientScript()

  fastify.get(CLIENT_SCRIPT_PATH, async (request, reply) => {
    // no-cache rather than a long max-age: there is no hash in the filename, so
    // a cached copy would outlive a deploy.
    return await reply
      .type('text/javascript; charset=utf-8')
      .header('cache-control', 'no-cache')
      .send(clientScript)
  })

  fastify.get('/', async (request, reply) => {
    const page = fastify.dashboardService.listInstances(null, PAGE_SIZE)

    const html = renderDashboardPage({
      instances: page.instances,
      metricNames: page.metricNames,
      nextCursor: page.nextCursor
    })

    return await reply.type('text/html; charset=utf-8').send(html)
  })

  /**
   * Feeds the "Load more" button. Returns rendered `<tr>` markup rather than
   * data so escaping and column layout stay in one place — the alternative is a
   * second row renderer in browser JS that has to agree with the server's.
   *
   * Not part of the public JSON API: it exists to serve this page's markup, and
   * /api/v1/instances remains the contract for programmatic clients.
   */
  fastify.get<{ Querystring: { cursor: string, columns?: string } }>('/rows', {
    schema: {
      querystring: rowsQuerySchema,
      response: { 200: rowsResponseSchema }
    }
  }, async (request) => {
    const page = fastify.dashboardService.listInstances(Number(request.query.cursor), PAGE_SIZE)

    // Columns the client already shows keep their position; anything this page
    // introduces is appended, and the script widens the earlier rows to match.
    const shownColumns = parseColumns(request.query.columns)
    const newColumns = page.metricNames.filter((name) => !shownColumns.includes(name))

    return {
      rowsHtml: renderInstanceRows(page.instances, [...shownColumns, ...newColumns]),
      newColumns,
      nextCursor: page.nextCursor
    }
  })
}

export default dashboard
