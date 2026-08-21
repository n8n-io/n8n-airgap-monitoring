import bearerAuth from "@fastify/bearer-auth";
import type { FastifyPluginAsync } from "fastify";

/**
 * Lets the dashboard verify a typed secret without fetching any real data.
 * `@fastify/bearer-auth` does the actual check and answers 401 itself, so a
 * request that reaches the handler is by definition valid — there is nothing
 * left to do but say so.
 */
const authCheck: FastifyPluginAsync = async (fastify): Promise<void> => {
  await fastify.register(bearerAuth, {
    keys: new Set([fastify.config.dashboardAuthToken]),
  });

  fastify.get("/auth/check", async (_request, reply) => {
    // Never cached: a stale 204 for a token that has since been rotated would
    // read as "still logged in".
    reply.header("cache-control", "no-store").code(204);
  });
};

export default authCheck;
