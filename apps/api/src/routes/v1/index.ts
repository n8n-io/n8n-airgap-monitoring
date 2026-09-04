import type { FastifyPluginAsync } from "fastify";
import instanceReportRoutes from "./instance-reports";
import reportRoutes from "./report";

const v1Routes: FastifyPluginAsync = async (fastify): Promise<void> => {
  void fastify.register(instanceReportRoutes, { prefix: "/instance-reports" });
  void fastify.register(reportRoutes, { prefix: "/report" });
};

export default v1Routes;
