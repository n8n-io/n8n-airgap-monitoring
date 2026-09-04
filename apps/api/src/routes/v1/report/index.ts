import type { FastifyPluginAsync } from "fastify";
import getReport from "./get-report.route";

// Routes in this folder are registered manually here, not discovered via autoloading of a directory.
const reportRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  void fastify.register(getReport);
};

export default reportRoutes;
