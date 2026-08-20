import type { FastifyPluginAsync } from "fastify";
import instanceReportRoutes from "./instance-report";

const v1Routes: FastifyPluginAsync = async (fastify): Promise<void> => {
  void fastify.register(instanceReportRoutes, { prefix: "/instance-report" });
};

export default v1Routes;
