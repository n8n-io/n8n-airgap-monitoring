import bearerAuth from "@fastify/bearer-auth";
import type { FastifyPluginAsync } from "fastify";
import { isPending } from "../../../submissions/submissions.service";

// Guarded by the read token, which the submit page asks for on every load. The page then fetches
// each month from GET /api/v1/report with the same token.

const monthParamsSchema = {
  type: "object",
  required: ["month"],
  properties: {
    // YYYY-MM, e.g. 2026-09
    month: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" },
  },
};

const submissionRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
  await fastify.register(bearerAuth, {
    keys: new Set([fastify.config.readToken]),
  });

  // The destination's auth token is only handed out behind the read token: the page itself is
  // public, and the browser has to hold the token to send it to n8n.
  // no-store: the response carries the destination's auth token.
  fastify.get("/", async (_request, reply) =>
    reply.header("cache-control", "no-store").send({
      ...(await fastify.submissionService.overview()),
      destination: fastify.config.reportDestination ?? null,
      uploadFormUrl: fastify.config.reportUploadFormUrl ?? null,
    }),
  );

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
};

export default submissionRoutes;
