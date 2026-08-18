import bearerAuth from '@fastify/bearer-auth'
import { type FastifyPluginAsync } from 'fastify'
import { type UsageReport } from '../../../../usage/usage.service'

// A running total (kind: cumulative, can regress after a customer DB rollback)
// or a value scoped to one reporting window (kind: interval, e.g. billable
// executions per day). Expressed as one schema with a conditional rather than
// oneOf: fastify's default `removeAdditional` strips an interval metric's
// batchId/start/end while probing the cumulative branch first, so oneOf would
// reject every valid interval metric before it ever reaches that branch.
const metricSchema = {
  type: 'object',
  required: ['kind', 'name', 'value'],
  additionalProperties: false,
  properties: {
    kind: { enum: ['cumulative', 'interval'] },
    name: { type: 'string', minLength: 1 },
    value: { type: 'number' },
    // Generated on the reporting instance; distinguishes a retry of the same
    // window from two instances that happen to share an instanceId.
    batchId: { type: 'string', minLength: 1 },
    // ISO strings in UTC. The window is half-open [start, end): end is the
    // instant the next window starts, so windows tile without gaps or overlaps.
    start: { type: 'string', minLength: 1 },
    end: { type: 'string', minLength: 1 }
  },
  if: { properties: { kind: { const: 'interval' } } },
  then: { required: ['batchId', 'start', 'end'] }
}

const usageReportSchema = {
  type: 'object',
  required: ['instanceId', 'n8nVersion', 'dataPoints'],
  additionalProperties: false,
  properties: {
    instanceId: { type: 'string', minLength: 1 },
    label: { type: 'string', minLength: 1, maxLength: 200 },
    n8nVersion: { type: 'string', minLength: 1 },
    // Metric names are chosen by the reporting instance, so only the
    // envelope (cumulative vs interval) is pinned down.
    dataPoints: {
      type: 'array',
      minItems: 1,
      items: metricSchema
    }
  }
}

const successResponseSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'integer' }
  }
}

const ingest: FastifyPluginAsync = async (fastify): Promise<void> => {
  await fastify.register(bearerAuth, {
    keys: new Set([fastify.config.authToken])
  })

  fastify.post<{ Body: UsageReport }>('/', {
    schema: {
      body: usageReportSchema,
      response: { 201: successResponseSchema }
    }
  }, async function (request, reply) {
    reply.code(201)

    return fastify.usageService.recordReport(request.body)
  })
}

export default ingest
