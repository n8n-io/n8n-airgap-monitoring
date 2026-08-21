import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export interface Config {
  instanceAuthToken: string;
  dashboardAuthToken: string;
  dbPath: string;
  /**
   * Directory holding the built dashboard SPA. Set by the Docker image; unset
   * when the API runs on its own, in which case nothing static is served.
   */
  dashboardDistPath: string | undefined;
}

/**
 * Reads deployment configuration from the environment.
 *
 * A missing token aborts startup rather than defaulting to open access: this
 * service is the billing record for airgapped customers, so an unauthenticated
 * collector quietly accepting writes from anything on the internal network
 * would be worse than a container that refuses to boot.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    const instanceAuthToken = process.env.N8N_INSTANCE_AUTH_TOKEN?.trim();
    if (!instanceAuthToken) {
      throw new Error("N8N_INSTANCE_AUTH_TOKEN must be set to a non-empty value");
    }

    const dashboardAuthToken = process.env.N8N_DASHBOARD_AUTH_TOKEN?.trim();
    if (!dashboardAuthToken) {
      throw new Error("N8N_DASHBOARD_AUTH_TOKEN must be set to a non-empty value");
    }

    const config: Config = {
      instanceAuthToken,
      dashboardAuthToken,
      dbPath: process.env.N8N_DB_PATH?.trim() || "./data/cmfae.sqlite",
      dashboardDistPath: process.env.N8N_DASHBOARD_DIST?.trim() || undefined,
    };

    fastify.decorate("config", config);
  },
  { name: "config" },
);

declare module "fastify" {
  export interface FastifyInstance {
    config: Config;
  }
}
