// A mock CA persisted to disk, so processes other than a test run can mint
// license certificates a receiver in test mode trusts. Written by the
// mock-license CLI, read by mock-license and mock-report; the k8s demo keeps
// one in a gitignored directory for the life of its cluster.
//
// ai-assistant-service has no equivalent because it never needs a mock
// certificate outside Jest: its client is a developer's own n8n instance,
// which is licensed and brings a real certificate. This service has the same
// real path, but its demo and backfill tooling post reports without an n8n
// instance, and those need a certificate from a CA that outlives one process
// and is shared between the receiver and the minting side. The CA is never
// committed; `make nuke` deletes it with the cluster.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateMockCa, type MockCa } from "./mock-license.ts";

export const CA_KEY_FILE = "ca.key.pem";
export const CA_CERT_FILE = "ca.cert.pem";

/** Named so anyone who meets it in a log knows what it is. */
const DEV_CA_COMMON_NAME = "airgap-monitoring dev license CA - DO NOT TRUST";

/** Generates a fresh CA and writes its key and certificate into `dir`. */
export function writeDevCa(dir: string): MockCa {
  const generated = generateMockCa(DEV_CA_COMMON_NAME);
  // node-forge emits CRLF PEM; plain LF keeps the files, and anything that
  // inlines them (a Helm value, an env var), readable.
  const ca: MockCa = {
    privateKeyPem: generated.privateKeyPem.replace(/\r\n/g, "\n"),
    certPem: generated.certPem.replace(/\r\n/g, "\n"),
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, CA_KEY_FILE), ca.privateKeyPem, { mode: 0o600 });
  writeFileSync(join(dir, CA_CERT_FILE), ca.certPem);
  return ca;
}

export function readDevCa(dir: string): MockCa {
  return {
    privateKeyPem: readFileSync(join(dir, CA_KEY_FILE), "utf8"),
    certPem: readFileSync(join(dir, CA_CERT_FILE), "utf8"),
  };
}
