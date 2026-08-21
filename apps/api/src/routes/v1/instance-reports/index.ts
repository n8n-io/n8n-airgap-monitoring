import type { FastifyPluginAsync } from "fastify";
import createInstanceReport from "./create-instance-report.route";
import getInstanceReportMetricHistory from "./get-instance-report-metric-history.route";
import getInstanceReports from "./get-instance-reports.route";

// Routes in this folder are registered here, not discovered, and the folder name
// is not the URL: the /instance-report prefix is applied one level up. Not wrapped
// in fastify-plugin on purpose, so the bearer-auth hook each route registers stays
// encapsulated to that route.
const instanceReportRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  void fastify.register(createInstanceReport);
  void fastify.register(getInstanceReports);
  void fastify.register(getInstanceReportMetricHistory);
};

export default instanceReportRoutes;
