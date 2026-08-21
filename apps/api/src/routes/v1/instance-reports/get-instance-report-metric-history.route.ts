import bearerAuth from "@fastify/bearer-auth";
import type { FastifyPluginAsync } from "fastify";

const paramsSchema = {
  type: "object",
  required: ["instanceId", "metricName"],
  properties: {
    instanceId: { type: "string", minLength: 1 },
    metricName: { type: "string", minLength: 1 },
  },
};

// One schema with a conditional, not oneOf: fast-json-stringify serializes by
// matching properties present on the value, and a daily point vs a cumulative
// point don't share a discriminating shape the same way create-instance-report's
// input does — branching on `kind` keeps this consistent with that route anyway.
const metricHistorySchema = {
  type: "object",
  required: ["kind", "points"],
  properties: {
    kind: { enum: ["daily", "cumulative"] },
    points: { type: "array" },
  },
  if: { properties: { kind: { const: "daily" } } },
  // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword, not a thenable
  then: {
    properties: {
      points: {
        type: "array",
        items: {
          type: "object",
          required: ["date", "value", "batchId"],
          properties: {
            date: { type: "string" },
            value: { type: "number" },
            batchId: { type: "string" },
          },
        },
      },
    },
  },
  else: {
    properties: {
      points: {
        type: "array",
        items: {
          type: "object",
          required: ["receivedAt", "value"],
          properties: {
            receivedAt: { type: "string" },
            value: { type: "number" },
          },
        },
      },
    },
  },
};

const successResponseSchema = {
  type: "object",
  required: ["data"],
  properties: {
    data: metricHistorySchema,
  },
};

const notFoundResponseSchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string" },
  },
};

const getInstanceReportMetricHistory: FastifyPluginAsync = async (fastify): Promise<void> => {
  await fastify.register(bearerAuth, {
    keys: new Set([fastify.config.dashboardAuthToken]),
  });

  fastify.get<{ Params: { instanceId: string; metricName: string } }>(
    "/:instanceId/metrics/:metricName/history",
    {
      schema: {
        params: paramsSchema,
        response: { 200: successResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { instanceId, metricName } = request.params;
      const history = fastify.instanceReportService.getMetricHistory(instanceId, metricName);

      if (history === null) {
        reply.code(404);
        return { message: `No history for metric "${metricName}" on instance "${instanceId}"` };
      }

      return { data: history };
    },
  );
};

export default getInstanceReportMetricHistory;
