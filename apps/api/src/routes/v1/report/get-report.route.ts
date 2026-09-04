import bearerAuth from "@fastify/bearer-auth";
import type { FastifyPluginAsync } from "fastify";

/**
 * Downloads the full usage report as JSON. This is the billing export — its own resource,
 * and is guarded by the read token.
 *
 * Deliberately declares no response schema. Serializing against one rewrites the payload
 * rather than merely checking it — fast-json-stringify coerces, so a value stored as the
 * string "42" left here as the number 42. Ingest already refuses that trade (`coerceTypes:
 * false`, see app.ts) because a silently corrected number is worse than a rejected report,
 * and an export that quietly repairs its own billing figures on the way out undoes it. The
 * shape is fixed by {@link UsageReport} and pinned by tests instead.
 */
const getReport: FastifyPluginAsync = async (fastify): Promise<void> => {
  await fastify.register(bearerAuth, {
    keys: new Set([fastify.config.readToken]),
  });

  fastify.get("/", async (_request, reply) => {
    const report = fastify.instanceReportService.generateReport();

    // Colons and dots are unsafe in filenames on some OSes, so flatten the timestamp.
    const stamp = report.data.generatedAt.replace(/[:.]/g, "-");

    reply
      .header("cache-control", "no-store")
      .header("content-disposition", `attachment; filename="n8n-instance-report-${stamp}.json"`)
      .type("application/json");

    return report;
  });
};

export default getReport;
