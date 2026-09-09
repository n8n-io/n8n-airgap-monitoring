import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { InstanceReportRepository } from "./instance-report.repository";
import { InstanceReportService } from "./instance-report.service";

/**
 * Wires the instance layers together.
 *
 * Only the service is decorated onto the instance: routes have no way to reach
 * the repository, so the controller cannot bypass the business layer.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    const repository = new InstanceReportRepository(fastify.dataSource);

    fastify.decorate("instanceReportService", new InstanceReportService(repository));
  },
  { name: "instanceReport", dependencies: ["db"] },
);

declare module "fastify" {
  export interface FastifyInstance {
    instanceReportService: InstanceReportService;
  }
}
