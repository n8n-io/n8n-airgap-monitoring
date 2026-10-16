import type { FastifyPluginAsync } from "fastify";
import instanceReportRoutes from "./instance-reports";
import reportRoutes from "./report";
import submissionRoutes from "./submissions";

const v1Routes: FastifyPluginAsync = async (fastify): Promise<void> => {
  void fastify.register(instanceReportRoutes, { prefix: "/instance-reports" });
  void fastify.register(reportRoutes, { prefix: "/report" });
  void fastify.register(submissionRoutes, { prefix: "/submissions" });
};

export default v1Routes;
