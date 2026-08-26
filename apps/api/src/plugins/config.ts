import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export interface Config {
  writeToken: string;
  dbPath: string;
}

/**
 * Reads deployment configuration from the environment.
 *
 * A missing write token aborts startup rather than defaulting to open access:
 * this service is the billing record for airgapped customers, so an
 * unauthenticated collector quietly accepting writes from anything on the
 * internal network would be worse than a container that refuses to boot.
 *
 * The token is scoped to reporting, not to the service: it only authorizes the
 * instance-report write endpoint. Read access gets its own token, so whether a
 * missing read token is fatal is a separate decision from this one.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    const writeToken = process.env.N8N_MONITORING_WRITE_TOKEN?.trim();
    if (!writeToken) {
      throw new Error("N8N_MONITORING_WRITE_TOKEN must be set to a non-empty value");
    }

    const config: Config = {
      writeToken,
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
