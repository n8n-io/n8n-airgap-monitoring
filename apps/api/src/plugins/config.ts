import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

/** Where the submit page sends monthly usage, both values provided by n8n. */
export interface ReportDestination {
  url: string;
  /** Sent by the submit page as `Authorization: Bearer <authToken>`. */
  authToken: string;
}

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
  /** Undefined when neither variable is set: the submit page then cannot submit. */
  reportDestination: ReportDestination | undefined;
}

/** Both variables or neither, and a URL that parses, so a typo fails at start-up rather than on Submit. */
function readReportDestination(): ReportDestination | undefined {
  const url = process.env.N8N_MONITORING_REPORT_DESTINATION?.trim();
  const authToken = process.env.N8N_MONITORING_REPORT_DESTINATION_AUTH_TOKEN?.trim();
  if (!url && !authToken) {
    return undefined;
  }
  if (!url) {
    throw new Error(
      "N8N_MONITORING_REPORT_DESTINATION must be set when N8N_MONITORING_REPORT_DESTINATION_AUTH_TOKEN is",
    );
  }
  if (!authToken) {
    throw new Error(
      "N8N_MONITORING_REPORT_DESTINATION_AUTH_TOKEN must be set when N8N_MONITORING_REPORT_DESTINATION is",
    );
  }
  if (!URL.canParse(url)) {
    throw new Error("N8N_MONITORING_REPORT_DESTINATION must be an absolute URL");
  }
  return { url, authToken };
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
      reportDestination: readReportDestination(),
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
