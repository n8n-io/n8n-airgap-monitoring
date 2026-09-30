import { Readable } from "node:stream";
import bearerAuth from "@fastify/bearer-auth";
import type { FastifyPluginAsync } from "fastify";
import type { InstanceReportEntry, ReportFilter } from "../../../instance-report/instance-report.service";

// A single ?instanceId= arrives as a string, a repeated one as an array, and types are not coerced (see app.ts).
const instanceIdSchema = { type: "string", minLength: 1, maxLength: 256 };

const schema = {
  querystring: {
    type: "object",
    properties: {
      instanceId: {
        anyOf: [instanceIdSchema, { type: "array", minItems: 1, maxItems: 100, items: instanceIdSchema }],
      },
    },
  },
};

interface ReportQuery {
  instanceId?: string | string[];
}

function toFilter(query: ReportQuery): ReportFilter {
  if (query.instanceId === undefined) {
    return {};
  }

  return { instanceIds: [...new Set([query.instanceId].flat())].sort() };
}

function toFiltersString(filter: ReportFilter): string {
  return new URLSearchParams((filter.instanceIds ?? []).map((id) => ["instanceId", id])).toString();
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
  filters: string,
  entries: AsyncIterable<InstanceReportEntry>,
): AsyncGenerator<string> {
  yield `{"data":{"generatedAt":${JSON.stringify(generatedAt)},"filters":${JSON.stringify(filters)},"instances":[`;

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
