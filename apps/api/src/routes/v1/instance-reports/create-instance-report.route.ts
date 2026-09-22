import type { FastifyPluginAsync } from "fastify";
import { DuplicateBatchError } from "../../../instance-report/instance-report.repository";
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

// The request may also carry `licenseCert`, which is not listed here on
// purpose: the reportAuth preValidation hook verifies it and removes it from
// the body before this schema runs, so it is a credential and never part of
// the envelope that gets stored.
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

const errorResponseSchema = {
  type: "object",
  required: ["statusCode", "error", "message"],
  properties: {
    statusCode: { type: "integer" },
    error: { type: "string" },
    message: { type: "string" },
  },
};

const createInstanceReport: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.post<{ Body: CreateInstanceReport }>(
    "/",
    {
      // Either the write token as a bearer header or an n8n-issued license
      // certificate in the body; see plugins/report-auth.ts.
      preValidation: fastify.authenticateReport,
      schema: {
        body: instanceReportSchema,
        response: { 201: successResponseSchema, 401: errorResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        reply.code(201);

        return await fastify.instanceReportService.recordReport(request.body);
      } catch (error) {
        // An envelope is immutable, so a repeat is rejected.
        // The client sent something it was built never to send.
        if (error instanceof DuplicateBatchError) {
          throw fastify.httpErrors.conflict(error.message);
        }

        throw error;
      }
    },
  );
};

export default createInstanceReport;
