import { timingSafeEqual, X509Certificate } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { N8N_LICENSE_ISSUER_CERT_PEM } from "../license/issuer-cert";
import { LicenseCertError, verifyLicenseCert } from "../license/license-cert";

/** Name of the body field carrying the certificate. Stripped before the body goes anywhere else. */
export const LICENSE_CERT_FIELD = "licenseCert";

type Verifier = (request: FastifyRequest) => void;

/**
 * Authenticates a reporting n8n instance. The operator picks one of two modes
 * by whether `N8N_MONITORING_WRITE_TOKEN` is set; the choice is made once at
 * start-up and there is no mode that accepts both:
 *
 * - Token mode (variable set): the request must carry the token verbatim as
 *   `Authorization: Bearer <token>`. Certificates are not looked at, so only
 *   holders of the operator's secret can write, and the endpoint needs no
 *   network restriction beyond TLS.
 * - Certificate mode (variable unset): the request must carry the instance's
 *   n8n license certificate as `licenseCert` in the body. Possession of a
 *   certificate n8n issued is the whole check: no identity is read from it and
 *   nothing is stored. Any licensee's certificate passes, so the endpoint must
 *   be reachable only by the operator's own instances.
 *
 * The certificate travels in the body, not a header, because a real one is
 * about 7 KB and grows with every feature flag, which sits too close to the
 * 8 KB per-header default of common reverse proxies.
 *
 * Trust for certificates is the embedded n8n license CA. Tests replace it with
 * a mock CA via `TEST_LICENSE_ISSUER_CERT`, honoured only under
 * `NODE_ENV=test`, the same mechanism ai-assistant-service uses. The
 * production image bakes `NODE_ENV=production`, so the variable is inert on a
 * deployed container.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    const { writeToken } = fastify.config;
    const verify: Verifier = writeToken !== undefined ? bearerVerifier(writeToken) : certificateVerifier();

    /**
     * Runs as `preValidation`, so the body is parsed but the route schema has
     * not seen it yet: a bad credential gets 401 before a malformed report gets
     * 400, and an unauthenticated caller learns nothing about the schema.
     */
    async function authenticateReport(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      verify(request);

      // The service persists the whole report object, so a certificate must
      // not still be in it, in either mode. The route schema would strip it
      // too, but a second write path must not depend on that.
      if (isRecord(request.body)) {
        delete request.body[LICENSE_CERT_FIELD];
      }
    }

    function bearerVerifier(expected: string): Verifier {
      return (request) => {
        const presented = bearerTokenOf(request);
        if (presented === undefined) {
          throw fastify.httpErrors.unauthorized("Missing write token");
        }
        if (!tokensEqual(presented, expected)) {
          // The presented value is never logged.
          request.log.warn({ code: "BAD_TOKEN" }, "Rejected write token");
          throw fastify.httpErrors.unauthorized("Invalid write token");
        }
      };
    }

    function certificateVerifier(): Verifier {
      const testCert = process.env.NODE_ENV === "test" ? process.env.TEST_LICENSE_ISSUER_CERT : undefined;
      const issuer = new X509Certificate(testCert || N8N_LICENSE_ISSUER_CERT_PEM);

      return (request) => {
        const body: unknown = request.body;
        if (!isRecord(body)) {
          throw fastify.httpErrors.unauthorized("Missing license certificate");
        }

        const cert = body[LICENSE_CERT_FIELD];
        if (typeof cert !== "string" || cert.length === 0) {
          throw fastify.httpErrors.unauthorized("Missing license certificate");
        }

        try {
          verifyLicenseCert(cert, issuer);
        } catch (error) {
          if (error instanceof LicenseCertError) {
            // The code is the only thing about the certificate that may be logged.
            request.log.warn({ code: error.code }, "Rejected license certificate");
            throw fastify.httpErrors.unauthorized("Invalid license certificate");
          }
          throw error;
        }
      };
    }

    fastify.decorate("authenticateReport", authenticateReport);
  },
  { name: "reportAuth", dependencies: ["config", "sensible"] },
);

/** The value after `Bearer `, or undefined when the header is absent or uses another scheme. */
function bearerTokenOf(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

/** Constant-time comparison, so response timing reveals nothing about the token. */
function tokensEqual(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

declare module "fastify" {
  export interface FastifyInstance {
    authenticateReport: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
