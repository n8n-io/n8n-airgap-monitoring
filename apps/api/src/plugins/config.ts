import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

/** Where the submit page sends monthly usage, both values provided by n8n. */
export interface ReportDestination {
  url: string;
  /** Sent by the submit page as `Authorization: Bearer <authToken>`. */
  authToken: string;
}

/**
 * Shown when N8N_MONITORING_REPORT_UPLOAD_FORM_URL is blank. The real form URL is not in
 * public source; n8n provides it. Change this one constant to swap the default.
 */
export const PLACEHOLDER_REPORT_UPLOAD_FORM_URL = "https://example.com/n8n-airgap-monitoring/upload-form";

const WEB_PROTOCOLS = ["http:", "https:"];

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
  /** The manual upload form that the submit page links to. Undefined: the page hides the link. */
  reportUploadFormUrl: string | undefined;
}

/**
 * Both variables or neither, and an http(s) URL, so a typo fails at start-up rather than on Submit.
 * `URL.canParse` alone accepts `localhost:5678/webhook`, with `localhost:` as its scheme.
 */
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
  const protocol = URL.parse(url)?.protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("N8N_MONITORING_REPORT_DESTINATION must be an absolute http:// or https:// URL");
  }
  return { url, authToken };
}

/** A blank value falls back to the placeholder. The page renders the value as a link, so only web URLs pass. */
function readReportUploadFormUrl(): string | undefined {
  const url = process.env.N8N_MONITORING_REPORT_UPLOAD_FORM_URL?.trim();
  if (!url) {
    return PLACEHOLDER_REPORT_UPLOAD_FORM_URL;
  }
  const isWebUrl = URL.canParse(url) && WEB_PROTOCOLS.includes(new URL(url).protocol);
  if (!isWebUrl) {
    throw new Error("N8N_MONITORING_REPORT_UPLOAD_FORM_URL must be an absolute http(s) URL");
  }
  return url;
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
      reportUploadFormUrl: readReportUploadFormUrl(),
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
