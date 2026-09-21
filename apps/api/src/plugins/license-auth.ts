import type { X509Certificate } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { N8N_LICENSE_ISSUER_CERT_PEM } from "../license/issuer-cert";
import { LicenseCertError, parseIssuerCertsPem, verifyLicenseCert } from "../license/license-cert";

/** Name of the body field carrying the certificate. Stripped before the body goes anywhere else. */
export const LICENSE_CERT_FIELD = "licenseCert";

/**
 * Authenticates a reporting n8n instance by the license certificate it sends
 * in the request body. Possession of a certificate n8n issued is the whole
 * check: no identity is read from it and nothing is stored.
 *
 * The certificate travels in the body, not a header, because a real one is
 * about 7 KB and grows with every feature flag, which sits too close to the
 * 8 KB per-header default of common reverse proxies.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    const issuers: X509Certificate[] = parseIssuerCertsPem(N8N_LICENSE_ISSUER_CERT_PEM);

    const extra = parseIssuerCertsPem(fastify.config.additionalIssuerCertsPem);
    if (extra.length > 0) {
      // Loud on purpose: the only legitimate reasons are a CA rotation or a
      // development setup, and a development CA in a real deployment must be
      // visible in the first lines of the log.
      fastify.log.warn(
        { issuers: extra.map((cert) => cert.subject.replace(/\n/g, ", ")) },
        "Trusting additional license issuers beyond the n8n license CA",
      );
      issuers.push(...extra);
    }

    /**
     * Runs as `preValidation`, so the body is parsed but the route schema has
     * not seen it yet: a bad certificate gets 401 before a malformed report gets
     * 400, and an unauthenticated caller learns nothing about the schema.
     */
    async function verifyLicenseCertHook(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      const body: unknown = request.body;
      if (!isRecord(body)) {
        throw fastify.httpErrors.unauthorized("Missing license certificate");
      }

      const cert = body[LICENSE_CERT_FIELD];
      if (typeof cert !== "string" || cert.length === 0) {
        throw fastify.httpErrors.unauthorized("Missing license certificate");
      }

      try {
        verifyLicenseCert(cert, issuers);
      } catch (error) {
        if (error instanceof LicenseCertError) {
          // The code is the only thing about the certificate that may be logged.
          request.log.warn({ code: error.code }, "Rejected license certificate");
          throw fastify.httpErrors.unauthorized("Invalid license certificate");
        }
        throw error;
      }

      // The service persists the whole report object, so the certificate must
      // not still be in it. The route schema would strip it too, but a second
      // write path must not depend on that.
      delete body[LICENSE_CERT_FIELD];
    }

    fastify.decorate("verifyLicenseCert", verifyLicenseCertHook);
  },
  { name: "licenseAuth", dependencies: ["config", "sensible"] },
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

declare module "fastify" {
  export interface FastifyInstance {
    verifyLicenseCert: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
