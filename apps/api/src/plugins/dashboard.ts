import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

/**
 * Serves the built dashboard SPA from the same origin as the API.
 *
 * The Docker image ships both apps in one container, which keeps the airgapped
 * deployment to a single unit and sidesteps CORS entirely. Outside that image
 * `N8N_DASHBOARD_DIST` is unset and this plugin does nothing, so the API-only
 * dev and test setups are unaffected.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    const root = fastify.config.dashboardDistPath;
    if (!root) return;

    if (!existsSync(root)) {
      throw new Error(`N8N_DASHBOARD_DIST points at a missing directory: ${root}`);
    }

    await fastify.register(fastifyStatic, { root });

    // vue-router runs in history mode, so a deep link like /instances/42 is a
    // real GET the browser sends to us. Anything that is not an API call gets
    // index.html and the router takes it from there; API paths keep their JSON
    // 404 so a typo'd endpoint does not answer with HTML.
    fastify.setNotFoundHandler((request, reply) => {
      const isBrowserNavigation = request.method === "GET" || request.method === "HEAD";
      const path = request.url.split("?")[0];
      const isApi = path === "/healthz" || path === "/api" || path.startsWith("/api/");

      if (isBrowserNavigation && !isApi) {
        return reply.type("text/html").sendFile("index.html");
      }

      return reply.code(404).send({ statusCode: 404, error: "Not Found", message: "Route not found" });
    });
  },
  { name: "dashboard", dependencies: ["config"] },
);
