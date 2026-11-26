import type { ReportDestination } from "./plugins/config";

/** The submit page may only talk to this service and to the report destination. */
export function contentSecurityPolicy(destination: ReportDestination | undefined): string {
  const connectSrc = destination === undefined ? "'self'" : `'self' ${new URL(destination.url).origin}`;
  return ["default-src 'self'", `connect-src ${connectSrc}`, "base-uri 'none'", "form-action 'none'"].join("; ");
}
