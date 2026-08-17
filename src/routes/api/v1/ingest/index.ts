import bearerAuth from '@fastify/bearer-auth'
import { type FastifyPluginAsync } from 'fastify'

export interface UsageReport {
  instanceId: string
  n8nVersion: string
  data: Record<string, number>
}

const usageReportSchema = {
  type: 'object',
  required: ['instanceId', 'n8nVersion', 'data'],
  additionalProperties: false,
  properties: {
    instanceId: { type: 'string', minLength: 1 },
    n8nVersion: { type: 'string', minLength: 1 },
    data: {
      type: 'object',
      minProperties: 1,
      // Metric names are chosen by the reporting instance,
      // so only the value type is pinned down. Values may be counters,
      // percentages or decimals, and may go up or down between reports.
      additionalProperties: { type: 'number' }
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

  const insertEvent = fastify.db.prepare(
    `INSERT INTO usage_events (instance_id, n8n_version, data, received_at)
     VALUES (?, ?, ?, ?)`
  )

  fastify.post<{ Body: UsageReport }>('/', {
    schema: {
      body: usageReportSchema,
      response: { 201: successResponseSchema }
    }
  }, async function (request, reply) {
    const { instanceId, n8nVersion, data } = request.body

    // Every report is appended, never merged into a per-instance row: the
    // history is what makes a disputed invoice auditable after the fact.
    // The reporting clock is outside our trust boundary, so arrival time is
    // stamped here.
    const { lastInsertRowid } = insertEvent.run(
      instanceId,
      n8nVersion,
      JSON.stringify(data),
      new Date().toISOString()
    )

    reply.code(201)
    return { id: Number(lastInsertRowid) }
  })
}

export default ingest
