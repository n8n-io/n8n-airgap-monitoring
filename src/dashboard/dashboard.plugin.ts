import fp from 'fastify-plugin'
import { DashboardRepository } from './dashboard.repository'
import { DashboardService } from './dashboard.service'

/**
 * Wires the dashboard's read-only layers together.
 *
 * Kept separate from the `usage` module: this has no write logic and a
 * different set of queries, so it doesn't belong on UsageRepository/UsageService.
 */
export default fp(async (fastify) => {
  const repository = new DashboardRepository(fastify.db)

  fastify.decorate('dashboardService', new DashboardService(repository))
}, { name: 'dashboard', dependencies: ['db'] })

declare module 'fastify' {
  export interface FastifyInstance {
    dashboardService: DashboardService;
  }
}
