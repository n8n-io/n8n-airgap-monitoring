import bearerAuth from "@fastify/bearer-auth";
import type { FastifyPluginAsync } from "fastify";
import type { CreateInstanceReport } from "../../../instance-report/instance-report.service";

// A running total (kind: cumulative, can regress after a customer DB rollback)
// or a value covering one UTC calendar day (kind: daily, e.g. billable
// executions for that day). Expressed as one schema with a conditional rather
// than oneOf: fastify's default `removeAdditional` strips a daily metric's
// date while probing the cumulative branch first, so oneOf would reject every
// valid daily metric before it ever reaches that branch.
const metricSchema = {
  type: "object",
  required: ["kind", "name", "value"],
  additionalProperties: false,
  properties: {
    kind: { enum: ["cumulative", "daily"] },
    name: { type: "string", minLength: 1 },
    value: { type: "number" },
    // The UTC calendar day this value covers. `format: date` rejects
    // non-calendar days (e.g. 2026-02-30) as well as malformed strings.
    date: { type: "string", format: "date" },
  },
  if: { properties: { kind: { const: "daily" } } },
  // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditional keyword, not a thenable
  then: { required: ["date"] },
  else: { properties: { date: false } },
};

const instanceReportSchema = {
  type: "object",
  required: ["instanceId", "batchId", "n8nVersion", "dataPoints"],
  additionalProperties: false,
  properties: {
    instanceId: { type: "string", minLength: 1 },
    batchId: { type: "string", minLength: 1 },
    label: { type: "string", minLength: 1, maxLength: 200 },
    n8nVersion: { type: "string", minLength: 1 },
    // Metric names are chosen by the reporting instance, so only the
    // envelope (cumulative vs daily) is pinned down.
    dataPoints: {
      type: "array",
      minItems: 1,
      items: metricSchema,
    },
  },
};

const successResponseSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "integer" },
  },
};

const createInstanceReport: FastifyPluginAsync = async (fastify): Promise<void> => {
  await fastify.register(bearerAuth, {
    keys: new Set([fastify.config.authToken]),
  });

  fastify.post<{ Body: CreateInstanceReport }>(
    "/",
    {
      schema: {
        body: instanceReportSchema,
        response: { 201: successResponseSchema },
      },
    },
    async (request, reply) => {
      reply.code(201);

      return fastify.instanceReportService.recordReport(request.body);
    },
  );
};

export default createInstanceReport;
