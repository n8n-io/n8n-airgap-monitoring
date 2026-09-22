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

The shared write token stays available as an optional alternative, and it selects the mode. When the operator sets `N8N_MONITORING_WRITE_TOKEN` on the service, every report must carry it in its `Authorization: Bearer` header, compared in constant time, and license certificates are not a credential. Without a configured token, the certificate is checked. The choice is made once at start-up and there is no mode that accepts both. Token mode keeps the service deployable for instances that have no certificate, and for operators who cannot or do not want to restrict the POST endpoint to their own instances at the network level: with the certificate path closed, only holders of their secret can write, so TLS is the remaining requirement. Certificate mode removes the distribution chore and carries the network requirement instead.

Deliberately not checked: expiry, termination, clock skew, entitlements, features, tenant, device fingerprint. An expired instance is still a licensed instance and its usage is still wanted. No identity is read from the certificate, nothing is stored, and nothing is exported. The hook deletes `licenseCert` from the body before the route schema and the service see it, and a test asserts that neither the stored row nor the export contains it. On rejection the service logs a reason code and nothing else about the certificate.

The certificate travels in the body, not an `Authorization` header, because a measured real certificate is 7,334 bytes and grows with every feature flag. That sits within 10 percent of the 8 KB per-header default of nginx, the Kubernetes nginx ingress and Apache, and the failure would be an opaque `400` from the customer's proxy that neither side logs. Bodies have no comparable limit.

The verifier lives in this repository (`apps/api/src/license/`), a port of the `ai-assistant-service` implementation including its leaf signature check, which the public license SDK lacks. The SDK exposes no stateless verification API, and a customer-deployed service can only receive SDK changes through a new image anyway.

Trust is the embedded n8n license CA and nothing else. No operator setting widens it; a CA rotation ships as a new image, which the paragraph above already accepts as the only delivery path. Tests replace the CA with a mock one through `TEST_LICENSE_ISSUER_CERT`, which the auth plugin reads only under `NODE_ENV=test`, the mechanism `ai-assistant-service` uses for its tests. The production image bakes `NODE_ENV=production`, so the variable is inert on a deployed container, and a test pins that.

The read token stays as it is: its holder is the customer's operator, not a licensed instance.

## Alternatives Considered

- **Keep the shared write token as the only mechanism.** Rejected: it is the distribution chore this replaces, and it binds nothing to the caller. Kept as an optional alternative instead, because a required token would force operators who rely on the certificate to invent one they never use.
- **Accept both credentials at once when a write token is set.** Rejected: it is the one combination that is never safe without network rules, because the certificate path stays open to every licensee, and it is never needed, because an operator who has distributed a token gains nothing from also accepting certificates. The n8n side is already either/or per instance.
- **A separate mode variable** (`license-cert | write-token | both`) or a boolean opt-out of certificate auth. Rejected: a second setting can disagree with the token, needs start-up validation for that, and defaults either unsafe or with an inert token. One variable with two states is fail-safe by construction.
- **Exchange the certificate for a short-lived JWT**, as `ai-assistant-service` does for its chat endpoints. Rejected: a second endpoint plus a signing secret for a client that calls once a day, and the certificate must be sent to obtain the JWT anyway. `ai-assistant-service` itself validates the raw certificate per request on its newer endpoints.
- **Certificate in the `Authorization: Bearer` header.** Rejected for the header-size reason above. A custom scheme or a dedicated header shares the size problem, and a dedicated header is more likely than `Authorization` to be logged by middleware.
- **An operator-configurable PEM bundle of additional issuers**, named in a start-up warning and hidden from the Helm chart, for a CA rotation and for development CAs. Rejected: no production persona would use it. The embedded CA is valid until 2049, and a rotation would ship as a new image anyway, so it was a trust-widening switch in every customer's image for a scenario with no user. Development is served by the test-mode override instead.
- **Verifier as a new entry point in the license SDK or a new package.** Rejected: about 120 lines, and a customer-deployed image cannot pick up SDK changes without a rebuild anyway. Kept as the path if a third consumer appears.
- **Extract identity (`consumerRef`, `deviceFingerprint`) and bind `instanceId` to it, or persist license fields.** Rejected: ephemeral certificates carry little identity (zero `consumerId`, optional `consumerRef` and fingerprint), a fingerprint forces device lock and one certificate per instance, and the license fields are secret with no use case here.
- **Reject expired certificates.** Rejected: expired instances may report.
- **Send only a digest and signature** so the license never travels. Viable but needs a new SDK method and an n8n bump. Kept as a documented upgrade path.

## Consequences

- The write token becomes optional everywhere: config, Helm chart, compose file, docs. The service starts without it. `N8N_INSTANCE_REPORTING_AUTH_TOKEN` stays optional on the n8n side and, when set, makes the instance send the token and omit the certificate.
- A fleet uses one credential against one receiver. Unlicensed (community) instances can report only in token mode; in certificate mode n8n logs a warning and does not schedule.
- In certificate mode, any n8n licensee's certificate unlocks the receiver. Acceptable because that mode requires the receiver to be reachable only inside the customer's network; stated in the docs. Token mode has no such requirement, which is its reason to exist.
- The credential is the customer's license, which they already hold and which travels to `ai-assistant.n8n.io` on every licensed instance today. TLS stays the recommendation it was; proxies in front of the service must not log request bodies.
- A rejected request answers `401` before schema validation would answer `400`, so an unauthenticated caller learns nothing about the schema. The `401` uses the same error envelope as `409`.
- `licenseCert` is a transport-only field. It is stripped before storage and is not part of the envelope defined in `adr/2026-08-26-report-envelopes-are-immutable.md`.
- No breaking change for operators who keep a write token: an older instance that sends only the token is still accepted. An older receiver rejects instances that send a certificate and no token, so a fleet moving to certificates upgrades the receiver first.
- Local development and the k8s demo use the write token, as before this ADR. A licensed local n8n can use its certificate against the same receiver. Mock certificates exist only inside the test process; the `license-auth.e2e.test.ts` suite keeps the certificate path exercised over a real socket in CI.
- `NODE_ENV` becomes load-bearing. Vitest pins it to `test`, the Dockerfile to `production`, and the issuer override is the only behaviour that reads it.
- New runtime dependencies `node-rsa` and `crypto-js`, the same two the license SDK and server use. Replacing them with `node:crypto` alone is possible but untested.
