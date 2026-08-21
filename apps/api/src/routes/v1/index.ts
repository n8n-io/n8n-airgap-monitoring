import type { FastifyPluginAsync } from "fastify";
import authCheck from "./auth-check.route";
import instanceReportRoutes from "./instance-reports";

const v1Routes: FastifyPluginAsync = async (fastify): Promise<void> => {
  void fastify.register(instanceReportRoutes, { prefix: "/instance-reports" });
  void fastify.register(authCheck);
};

export default v1Routes;
