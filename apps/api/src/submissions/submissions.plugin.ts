import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { InstanceReportRepository } from "../instance-report/instance-report.repository";
import { SubmissionService } from "./submissions.service";

/** SPIKE (API-463): wires the submission history next to the instance report store. */
export default fp(
  async (fastify: FastifyInstance) => {
    const repository = new InstanceReportRepository(fastify.dataSource);

    fastify.decorate("submissionService", new SubmissionService(fastify.dataSource, repository));
  },
  { name: "submissions", dependencies: ["db"] },
);

declare module "fastify" {
  export interface FastifyInstance {
    submissionService: SubmissionService;
  }
}
