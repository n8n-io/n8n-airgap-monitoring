import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export interface Config {
  readToken: string;
  /**
   * PEM bundle of license issuers trusted in addition to the n8n license CA.
   * Empty in a normal deployment. Set for a CA rotation, or to a development
   * CA locally. Every issuer here is named in a warning at start-up.
   */
  additionalIssuerCertsPem: string;
  dbPath: string;
}

/**
 * Reads deployment configuration from the environment.
 *
 * There is no write token: reporting n8n instances authenticate with their
 * license certificate, see plugins/license-auth.ts.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    const readToken = process.env.N8N_MONITORING_READ_TOKEN?.trim();
    if (!readToken) {
      throw new Error("N8N_MONITORING_READ_TOKEN must be set to a non-empty value");
    }

    const config: Config = {
      readToken,
      additionalIssuerCertsPem: process.env.N8N_MONITORING_ADDITIONAL_ISSUER_CERTS?.trim() ?? "",
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
