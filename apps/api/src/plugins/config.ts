import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export interface Config {
  authToken: string;
  dbPath: string;
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
    const authToken = process.env.N8N_AUTH_TOKEN?.trim();
    if (!authToken) {
      throw new Error("N8N_AUTH_TOKEN must be set to a non-empty value");
    }

    const config: Config = {
      authToken,
      dbPath: process.env.N8N_DB_PATH?.trim() || "./data/cmfae.sqlite",
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
