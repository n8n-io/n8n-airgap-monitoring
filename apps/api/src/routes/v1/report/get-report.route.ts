import { Readable } from "node:stream";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import bearerAuth from "@fastify/bearer-auth";
import type { FastifyPluginAsync } from "fastify";
import type { InstanceReportEntry } from "../../../instance-report/instance-report.service";

/**
 * The report as JSON text, one instance per chunk.
 *
 * The framing is written by hand so each instance can be handed to the socket and
 * released immediately. A response schema would defeat that on its own — fastify
 * serializes the whole payload in one synchronous pass, which is the memory and
 * event-loop cost this route exists to avoid — and it also rewrote what it touched,
 * coercing a value stored as "42" into 42. The shape is pinned by {@link UsageReport}
 * and its tests instead.
 */
async function* renderReport(generatedAt: string, entries: Iterable<InstanceReportEntry>): AsyncGenerator<string> {
  yield `{"data":{"generatedAt":${JSON.stringify(generatedAt)},"instances":[`;

  let separator = "";
  for (const entry of entries) {
    yield separator + JSON.stringify(entry);
    separator = ",";

    // Reading the next instance is queued as a task rather than chained onto this
    // one, so arriving reports are served between chunks. Without this the whole
    // document is produced in a single microtask drain and ingest waits it out —
    // streaming would bound the memory but keep every one of the seconds.
    await yieldToEventLoop();
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

  fastify.get("/", async (request, reply) => {
    const { generatedAt, entries } = fastify.instanceReportService.reportStream();

    // Colons and dots are unsafe in filenames on some OSes, so flatten the timestamp.
    const stamp = generatedAt.replace(/[:.]/g, "-");

    const body = Readable.from(renderReport(generatedAt, entries), { objectMode: false });

    // A read that fails partway cannot become a 500: the status line and the first
    // instances are already on the wire. Destroying the stream aborts the transfer,
    // so the client sees a failed download rather than a plausible short one.
    body.on("error", (error) => {
      request.log.error({ err: error }, "report stream failed after the response had started");
    });

    reply
      .header("cache-control", "no-store")
      .header("content-disposition", `attachment; filename="n8n-instance-report-${stamp}.json"`)
      // Required for a stream: fastify infers a content type for objects, not for bytes.
      .type("application/json");

    return body;
  });
};

export default getReport;
