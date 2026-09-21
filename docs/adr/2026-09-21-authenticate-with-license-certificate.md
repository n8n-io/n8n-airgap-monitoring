# 10. Authenticate reporting instances with their n8n license certificate

> _This ADR was written by AI and reviewed by a human._

Date: 2026-09-21

Status: Active

## Context

`POST /api/v1/instance-reports` was guarded by a shared write token. The customer generated it, set it on this service as `N8N_MONITORING_WRITE_TOKEN`, and copied it to every n8n instance as `N8N_INSTANCE_REPORTING_AUTH_TOKEN`. That is one secret to mint and distribute per fleet, and it bound nothing to the caller.

Every licensed airgapped n8n instance already holds a credential that n8n issued: its license certificate, set as `N8N_LICENSE_CERT`. The certificate is a base64 container of an X509 leaf signed by the n8n license CA plus a payload signed by that leaf's key. It can be verified offline with the CA alone, which is what `ai-assistant-service` already does when n8n instances call it.

This service runs inside the customer's network, operated by the customer who also holds every certificate. The export it produces is shared with n8n by the customer. Authentication here therefore protects against unauthorised writers inside that network and removes a chore; it does not, and need not, make the export trustworthy to n8n.

## Decision

A reporting instance authenticates by sending its license certificate as the `licenseCert` field of the report body. The service verifies, in a `preValidation` hook, that the leaf chains to the n8n license CA and that the payload signature verifies. Possession of a certificate n8n issued is the whole check.

Deliberately not checked: expiry, termination, clock skew, entitlements, features, tenant, device fingerprint. An expired instance is still a licensed instance and its usage is still wanted. No identity is read from the certificate, nothing is stored, and nothing is exported. The hook deletes `licenseCert` from the body before the route schema and the service see it, and a test asserts that neither the stored row nor the export contains it. On rejection the service logs a reason code and nothing else about the certificate.

The certificate travels in the body, not an `Authorization` header, because a measured real certificate is 7,334 bytes and grows with every feature flag. That sits within 10 percent of the 8 KB per-header default of nginx, the Kubernetes nginx ingress and Apache, and the failure would be an opaque `400` from the customer's proxy that neither side logs. Bodies have no comparable limit.

The verifier lives in this repository (`apps/api/src/license/`), a port of the `ai-assistant-service` implementation including its leaf signature check, which the public license SDK lacks. The SDK exposes no stateless verification API, and a customer-deployed service can only receive SDK changes through a new image anyway.

Trust is the embedded n8n license CA plus an optional PEM bundle in `N8N_MONITORING_ADDITIONAL_ISSUER_CERTS`. That variable exists for a CA rotation and for development CAs. Every extra issuer is named in a warning at start-up, and the Helm chart does not expose the variable.

The read token stays as it is: its holder is the customer's operator, not a licensed instance.

## Alternatives Considered

- **Keep the shared write token.** Rejected: it is the distribution chore this replaces, and it binds nothing to the caller.
- **Exchange the certificate for a short-lived JWT**, as `ai-assistant-service` does for its chat endpoints. Rejected: a second endpoint plus a signing secret for a client that calls once a day, and the certificate must be sent to obtain the JWT anyway. `ai-assistant-service` itself validates the raw certificate per request on its newer endpoints.
- **Certificate in the `Authorization: Bearer` header.** Rejected for the header-size reason above. A custom scheme or a dedicated header shares the size problem, and a dedicated header is more likely than `Authorization` to be logged by middleware.
- **Verifier as a new entry point in the license SDK or a new package.** Rejected: about 120 lines, and a customer-deployed image cannot pick up SDK changes without a rebuild anyway. Kept as the path if a third consumer appears.
- **Extract identity (`consumerRef`, `deviceFingerprint`) and bind `instanceId` to it, or persist license fields.** Rejected: ephemeral certificates carry little identity (zero `consumerId`, optional `consumerRef` and fingerprint), a fingerprint forces device lock and one certificate per instance, and the license fields are secret with no use case here.
- **Reject expired certificates.** Rejected: expired instances may report.
- **Send only a digest and signature** so the license never travels. Viable but needs a new SDK method and an n8n bump. Kept as a documented upgrade path.

## Consequences

- No write token anywhere: config, Helm chart, compose file, docs. `N8N_INSTANCE_REPORTING_AUTH_TOKEN` disappears on the n8n side.
- Unlicensed (community) instances can no longer report. n8n logs a warning and does not schedule.
- Any n8n licensee's certificate unlocks any customer's receiver. Acceptable because the receiver is only reachable inside the customer's network; stated in the docs.
- The credential is the customer's license, which they already hold and which travels to `ai-assistant.n8n.io` on every licensed instance today. TLS stays the recommendation it was; proxies in front of the service must not log request bodies.
- A rejected request answers `401` before schema validation would answer `400`, so an unauthenticated caller learns nothing about the schema. The `401` uses the same error envelope as `409`.
- `licenseCert` is a transport-only field. It is stripped before storage and is not part of the envelope defined in `adr/2026-08-26-report-envelopes-are-immutable.md`.
- Breaking change, accepted while the service is new: a receiver on this version rejects instances that send a token and no certificate, and an older receiver rejects instances that send a certificate and no token. The receiver and the n8n instances must be upgraded together.
- Local development needs certificates a dev server trusts. The test generator (`apps/api/src/testing/mock-license.ts`) and the issuer override are the building blocks; a committed dev CA and a CLI follow in separate work.
- New runtime dependencies `node-rsa` and `crypto-js`, the same two the license SDK and server use. Replacing them with `node:crypto` alone is possible but untested.
