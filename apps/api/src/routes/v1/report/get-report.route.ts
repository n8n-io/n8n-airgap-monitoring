import { Readable } from "node:stream";
import bearerAuth from "@fastify/bearer-auth";
import type { FastifyPluginAsync } from "fastify";
import type { InstanceReportEntry } from "../../../instance-report/instance-report.service";

/**
 * Renders the UsageReport envelope as a byte stream: the fixed head, each instance as its own
 * `JSON.stringify` chunk, then the tail. Only one instance is serialised at a
 * time, so the whole report never sits in memory.
 *
 * There is no response schema on this route, as we need to create stream and the data itself was validated during upload.
 */
async function* renderReport(generatedAt: string, entries: AsyncIterable<InstanceReportEntry>): AsyncGenerator<string> {
  yield `{"data":{"generatedAt":${JSON.stringify(generatedAt)},"instances":[`;

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

  fastify.get("/", async (_request, reply) => {
    const generatedAt = new Date().toISOString();
    // Colons and dots are unsafe in filenames on some OSes, so flatten the timestamp.
    const stamp = generatedAt.replace(/[:.]/g, "-");

    reply
      .header("cache-control", "no-store")
      .header("content-disposition", `attachment; filename="n8n-instance-report-${stamp}.json"`)
      .type("application/json");

    // A DB error after the first chunk cannot un-send the 200 already on the
    // wire; the stream just breaks and the client gets a truncated file. That is
    // a trade-off for not buffering the whole report — a partial download is more honest
    // than a valid-looking but silently short one.
    return Readable.from(renderReport(generatedAt, fastify.instanceReportService.streamInstanceReports()));
  });
};

export default getReport;
