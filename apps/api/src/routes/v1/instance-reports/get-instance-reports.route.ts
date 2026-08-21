import bearerAuth from "@fastify/bearer-auth";
import type { FastifyPluginAsync } from "fastify";

const instanceSummarySchema = {
  type: "object",
  required: ["instanceId", "label", "n8nVersion", "receivedAt", "metrics"],
  properties: {
    instanceId: { type: "string" },
    label: { type: ["string", "null"] },
    n8nVersion: { type: "string" },
    receivedAt: { type: "string" },
    metrics: { type: "object", additionalProperties: { type: "number" } },
  },
};

const successResponseSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: {
      type: "object",
      required: ["instances"],
      properties: {
        instances: { type: "array", items: instanceSummarySchema },
      },
    },
  },
};

const getInstanceReports: FastifyPluginAsync = async (fastify): Promise<void> => {
  await fastify.register(bearerAuth, {
    keys: new Set([fastify.config.dashboardAuthToken]),
  });

  fastify.get(
    "/",
    {
      schema: {
        response: { 200: successResponseSchema },
      },
    },
    async () => {
      return { data: { instances: fastify.instanceReportService.listInstances() } };
    },
  );
};

export default getInstanceReports;
