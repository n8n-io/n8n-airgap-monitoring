import type { FastifyPluginAsync } from "fastify";
import createInstanceReport from "./create-instance-report.route";

// Routes in this folder are registered manually here, not discovered via autoloading of a directory.
const instanceReportRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  void fastify.register(createInstanceReport);
};

export default instanceReportRoutes;
