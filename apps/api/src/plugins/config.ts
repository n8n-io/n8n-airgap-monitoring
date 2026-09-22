import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export interface Config {
  readToken: string;
  /**
   * Optional shared secret that selects the authentication mode for reports.
   * Set: reporting instances must present it as a bearer token and license
   * certificates are not accepted. Undefined: only license certificates are
   * accepted. See plugins/report-auth.ts.
   */
  writeToken: string | undefined;
  dbPath: string;
}

/**
 * Reads deployment configuration from the environment.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    const readToken = process.env.N8N_MONITORING_READ_TOKEN?.trim();
    if (!readToken) {
      throw new Error("N8N_MONITORING_READ_TOKEN must be set to a non-empty value");
    }

    const config: Config = {
      readToken,
      writeToken: process.env.N8N_MONITORING_WRITE_TOKEN?.trim() || undefined,
      dbPath: process.env.N8N_DB_PATH?.trim() || "./data/database.sqlite",
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
