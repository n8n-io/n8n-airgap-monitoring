import { Readable } from "node:stream";
import bearerAuth from "@fastify/bearer-auth";
import { httpErrors } from "@fastify/sensible";
import type { FastifyPluginAsync } from "fastify";
import type { InstanceReportEntry, ReportFilter } from "../../../instance-report/instance-report.service";
import { airgapMonitoringVersion } from "../../../version";
import { errorResponseSchema } from "../error-response.schema";

// Several ids are comma-separated, so the limits are checked in toFilter, after splitting. A repeated
// ?instanceId= arrives as an array and is rejected, because types are not coerced (see app.ts).
const schema = {
  querystring: {
    type: "object",
    properties: {
      instanceId: { type: "string" },
    },
  },
  // Only 400: the 200 body is a stream and has no schema.
  response: {
    400: errorResponseSchema,
  },
};

const MAX_INSTANCE_IDS = 100;
// Same limit as on ingest.
const MAX_INSTANCE_ID_LENGTH = 256;

interface ReportQuery {
  instanceId?: string;
}

/** Worded like the schema's own errors, e.g. "querystring/instanceId must be string". */
function invalidInstanceId(reason: string): Error {
  return httpErrors.badRequest(`querystring/instanceId ${reason}`);
}

function toFilter(query: ReportQuery): ReportFilter {
  if (query.instanceId === undefined) {
    return {};
  }

  const instanceIds = [
    ...new Set(
      query.instanceId
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id !== ""),
    ),
  ].sort();

  if (instanceIds.length === 0) {
    throw invalidInstanceId("must not be empty");
  }
  if (instanceIds.length > MAX_INSTANCE_IDS) {
    throw invalidInstanceId(`must not have more than ${MAX_INSTANCE_IDS} values`);
  }
  if (instanceIds.some((id) => [...id].length > MAX_INSTANCE_ID_LENGTH)) {
    throw invalidInstanceId(`must not be longer than ${MAX_INSTANCE_ID_LENGTH} characters`);
  }

  return { instanceIds };
}

function toFiltersString(filter: ReportFilter): string | undefined {
  if (filter.instanceIds === undefined) {
    return undefined;
  }

  return `instanceId=${filter.instanceIds.map(encodeURIComponent).join(",")}`;
}

/**
 * Renders the UsageReport envelope as a byte stream: the fixed head, each instance as its own
 * `JSON.stringify` chunk, then the tail. Only one instance is serialised at a
 * time, so the whole report never sits in memory.
 *
 * There is no response schema on this route, as we need to create stream and the data itself was validated during upload.
 */
async function* renderReport(
  generatedAt: string,
  filters: string | undefined,
  entries: AsyncIterable<InstanceReportEntry>,
): AsyncGenerator<string> {
  const filtersField = filters === undefined ? "" : `"filters":${JSON.stringify(filters)},`;
  const versionField = `"airgapMonitoringVersion":${JSON.stringify(airgapMonitoringVersion)},`;
  yield `{"data":{"generatedAt":${JSON.stringify(generatedAt)},${versionField}${filtersField}"instances":[`;

  let first = true;
  for await (const entry of entries) {
    yield first ? JSON.stringify(entry) : `,${JSON.stringify(entry)}`;
    first = false;
  }

  yield "]}}";
}

/**
 * Downloads the full usage report as JSON. This is the billing export — its own resource,
 * and is guarded by the read token.
 */
const getReport: FastifyPluginAsync = async (fastify): Promise<void> => {
  await fastify.register(bearerAuth, {
    keys: new Set([fastify.config.readToken]),
  });

  fastify.get<{ Querystring: ReportQuery }>("/", { schema }, async (request, reply) => {
    const filter = toFilter(request.query);
    const generatedAt = new Date().toISOString();
    // Colons and dots are unsafe in filenames on some OSes, so flatten the timestamp.
    const stamp = generatedAt.replace(/[:.]/g, "-");

    reply
      .header("cache-control", "no-store")
      .header("content-disposition", `attachment; filename="n8n-instance-report-${stamp}.json"`)
      .type("application/json");

    const body = Readable.from(
      renderReport(generatedAt, toFiltersString(filter), fastify.instanceReportService.streamInstanceReports(filter)),
    );

    body.on("error", (error) => {
      request.log.error({ err: error }, "report stream failed after the response had started");
    });

    return body;
  });
};

export default getReport;
