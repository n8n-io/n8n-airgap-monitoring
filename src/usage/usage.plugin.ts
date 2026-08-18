import fp from 'fastify-plugin'
import { UsageRepository } from './usage.repository'
import { UsageService } from './usage.service'

/**
 * Wires the usage layers together.
 *
 * Only the service is decorated onto the instance: routes have no way to reach
 * the repository, so the controller cannot bypass the business layer.
 */
export default fp(async (fastify) => {
  const repository = new UsageRepository(fastify.db)

  fastify.decorate('usageService', new UsageService(repository))
}, { name: 'usage', dependencies: ['db'] })

declare module 'fastify' {
  export interface FastifyInstance {
    usageService: UsageService;
  }
}
