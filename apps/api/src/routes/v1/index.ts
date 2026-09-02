import type { FastifyPluginAsync } from "fastify";
import instanceReportRoutes from "./instance-reports";

const v1Routes: FastifyPluginAsync = async (fastify): Promise<void> => {
  void fastify.register(instanceReportRoutes, { prefix: "/instance-reports" });
};

export default v1Routes;
