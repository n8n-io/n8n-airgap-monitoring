import bearerAuth from "@fastify/bearer-auth";
import type { FastifyPluginAsync } from "fastify";

const dataPointSchema = {
  type: "object",
  required: ["kind", "value", "batchId", "receivedAt"],
  additionalProperties: false,
  properties: {
    kind: { enum: ["daily", "cumulative"] },
    value: { type: "number" },
    batchId: { type: "string", minLength: 1 },
    receivedAt: { type: "string" },
    date: { type: "string" },
  },
};

const instanceReportSchema = {
  type: "object",
  required: ["instanceId", "label", "firstSeen", "lastReportAt", "dataPoints"],
  additionalProperties: false,
  properties: {
    instanceId: { type: "string" },
    label: { type: ["string", "null"] },
    firstSeen: { type: "string" },
    lastReportAt: { type: "string" },
    // Metric names are chosen by the reporting instance, so the keys are open; only
    // the shape of each name's value array is pinned down.
    dataPoints: {
      type: "object",
      additionalProperties: { type: "array", items: dataPointSchema },
    },
  },
};

const successResponseSchema = {
  type: "object",
  required: ["data"],
  additionalProperties: false,
  properties: {
    data: {
      type: "object",
      required: ["generatedAt", "instances"],
      additionalProperties: false,
      properties: {
        generatedAt: { type: "string" },
        instances: { type: "array", items: instanceReportSchema },
      },
    },
  },
};

/**
 * Downloads the full usage report as JSON. This is the billing export — its own resource,
 * and is guarded by the read token.
 */
const getReport: FastifyPluginAsync = async (fastify): Promise<void> => {
  await fastify.register(bearerAuth, {
    keys: new Set([fastify.config.readToken]),
  });

  fastify.get(
    "/",
    {
      schema: {
        response: { 200: successResponseSchema },
      },
    },
    async (_request, reply) => {
      const report = await fastify.instanceReportService.generateReport();

      // Colons and dots are unsafe in filenames on some OSes, so flatten the timestamp.
      const stamp = report.data.generatedAt.replace(/[:.]/g, "-");

      reply
        .header("cache-control", "no-store")
        .header("content-disposition", `attachment; filename="n8n-instance-report-${stamp}.json"`)
        .type("application/json");

      return report;
    },
  );
};

export default getReport;
