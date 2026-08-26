import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export interface Config {
  writeToken: string;
  dbPath: string;
}

/**
 * Reads deployment configuration from the environment.
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
