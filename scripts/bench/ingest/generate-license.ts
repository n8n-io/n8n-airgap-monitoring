// Writes a throwaway mock CA and a license certificate it signed to .work/:
// ca.env for the server (compose.yml) and license-cert.txt for ingest.k6.js.

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildContainer, generateMockCa } from "../../../apps/api/src/test-utils/mock-license.ts";

// A real license certificate is 7,334 bytes (see LICENSE_CERT_BUDGET_BYTES).
const REAL_CERT_BYTES = 7_334;

const ca = generateMockCa("bench.license.n8n.io");
const payload = (padding: number) =>
  JSON.stringify({
    consumerId: randomUUID(),
    version: 2,
    tenantId: 1,
    entitlements: [{ id: randomUUID(), features: { "feat:sharing": true, padding: "x".repeat(padding) } }],
  });

// Padded to a real certificate's size, so the server parses and decrypts as
// much as in production. Base64 inside base64: each payload byte adds about
// (4/3)² container bytes.
const shortBy = REAL_CERT_BYTES - buildContainer(payload(0), ca).length;
const cert = buildContainer(payload(Math.max(0, Math.ceil(shortBy / (16 / 9)))), ca);

const dir = new URL(".work/", import.meta.url);
mkdirSync(dir, { recursive: true });
// One line with escaped newlines: the env file format compose reads.
const pem = ca.certPem.replaceAll("\r", "").trim().replaceAll("\n", "\\n");
writeFileSync(new URL("ca.env", dir), `TEST_LICENSE_ISSUER_CERT="${pem}"\n`);
writeFileSync(new URL("license-cert.txt", dir), `${cert}\n`);
