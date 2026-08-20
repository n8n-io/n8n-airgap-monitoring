import { type FastifyPluginAsync } from 'fastify'

// Query string values always arrive as strings, but the app-wide Ajv config
// disables type coercion (see src/app.ts) so a metric's `value` can't be
// silently coerced from a bool/null. That means numeric query params must be
// validated as digit-string patterns here and parsed by hand below, rather
// than declared as `type: 'integer'`.
const POSITIVE_INTEGER_STRING = { type: 'string', pattern: '^[1-9][0-9]*$' } as const

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 25
const MAX_HISTORY_POINTS = 1000
const DEFAULT_HISTORY_POINTS = 366

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: POSITIVE_INTEGER_STRING,
    cursor: POSITIVE_INTEGER_STRING
  }
}

const historyQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: { type: 'string', format: 'date' },
    to: { type: 'string', format: 'date' },
    limit: POSITIVE_INTEGER_STRING
  }
}

const metricValueSchema = {
  type: 'object',
  required: ['kind', 'value', 'receivedAt'],
  properties: {
    kind: { enum: ['daily', 'cumulative'] },
    value: { type: 'number' },
    date: { type: 'string' },
    receivedAt: { type: 'string' }
  }
}

const listResponseSchema = {
  type: 'object',
  required: ['instances', 'metricNames', 'nextCursor'],
  properties: {
    instances: {
      type: 'array',
      items: {
        type: 'object',
        required: ['instanceId', 'label', 'n8nVersion', 'lastReceivedAt', 'metrics'],
        properties: {
          instanceId: { type: 'string' },
          label: { type: ['string', 'null'] },
          n8nVersion: { type: 'string' },
          lastReceivedAt: { type: 'string' },
          metrics: { type: 'object', additionalProperties: metricValueSchema }
        }
      }
    },
    metricNames: { type: 'array', items: { type: 'string' } },
    nextCursor: { type: ['integer', 'null'] }
  }
}

const historyResponseSchema = {
  type: 'object',
  required: ['instanceId', 'metricName', 'kind', 'points'],
  properties: {
    instanceId: { type: 'string' },
    metricName: { type: 'string' },
    kind: { enum: ['daily', 'cumulative'] },
    points: { type: 'array' }
  }
}

const instances: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get<{ Querystring: { limit?: string, cursor?: string } }>('/', {
    schema: {
      querystring: listQuerySchema,
      response: { 200: listResponseSchema }
    }
  }, async (request) => {
    const limit = Math.min(
      request.query.limit === undefined ? DEFAULT_PAGE_SIZE : Number(request.query.limit),
      MAX_PAGE_SIZE
    )
    const cursor = request.query.cursor === undefined ? null : Number(request.query.cursor)

    return fastify.dashboardService.listInstances(cursor, limit)
  })

  fastify.get<{
    Params: { instanceId: string, metricName: string }
    Querystring: { from?: string, to?: string, limit?: string }
  }>('/:instanceId/metrics/:metricName/history', {
    schema: {
      querystring: historyQuerySchema,
      response: { 200: historyResponseSchema }
    }
  }, async (request, reply) => {
    const { instanceId, metricName } = request.params
    const limit = Math.min(
      request.query.limit === undefined ? DEFAULT_HISTORY_POINTS : Number(request.query.limit),
      MAX_HISTORY_POINTS
    )

    const history = fastify.dashboardService.getMetricHistory(instanceId, metricName, {
      from: request.query.from ?? null,
      to: request.query.to ?? null,
      limit
    })

    if (history === null) {
      return await reply.notFound(`Instance '${instanceId}' has never reported a metric named '${metricName}'`)
    }

    return { instanceId, metricName, ...history }
  })
}

export default instances
