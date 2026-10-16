import type { FastifyPluginAsync } from "fastify";
import { isPending } from "../../../submissions/submissions.service";
import { addReportRoute } from "../report/get-report.route";

// SPIKE (API-463): no auth on purpose, the submit page has no login. Anyone who reaches the
// service can read the report here and mark a month as submitted.

const monthParamsSchema = {
  type: "object",
  required: ["month"],
  properties: {
    // YYYY-MM, e.g. 2026-09
    month: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" },
  },
};

const submissionRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.get("/", async () => fastify.submissionService.overview());

  /** Records n8n's acknowledgement, which the browser reports, since this service never calls out. */
  fastify.post<{ Params: { month: string } }>(
    "/:month",
    { schema: { params: monthParamsSchema } },
    async (request, reply) => {
      const { month } = request.params;
      if (!isPending(month, new Date())) {
        throw fastify.httpErrors.badRequest("params/month must be a month that is pending");
      }

      await fastify.submissionService.record(month);
      return reply.code(201).send({ month });
    },
  );

  // The very same route as GET /api/v1/report, registered without the read token.
  void fastify.register(async (report) => addReportRoute(report), { prefix: "/report" });
};

export default submissionRoutes;
