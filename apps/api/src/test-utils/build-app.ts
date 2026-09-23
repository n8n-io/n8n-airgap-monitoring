// This file contains code that we reuse between our tests.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import fp from "fastify-plugin";
import { onTestFinished } from "vitest";
import app from "../app";
import { TEST_ISSUER_CERT_PEM } from "./mock-license";

process.env.N8N_MONITORING_READ_TOKEN = "test-read-token";
// Certificate mode by default: no write token, and the test CA is trusted once
// here, so every test mints certificates through mock-license.ts and nothing
// else. Tests of token mode stub N8N_MONITORING_WRITE_TOKEN before build().
// The auth plugin honours TEST_LICENSE_ISSUER_CERT only under NODE_ENV=test,
// which the Vitest config pins.
delete process.env.N8N_MONITORING_WRITE_TOKEN;
process.env.TEST_LICENSE_ISSUER_CERT = TEST_ISSUER_CERT_PEM;

// Automatically build and tear down our instance
async function build() {
  // Every test gets its own throwaway database file, so no test can observe
  // another test's events.
  const dataDir = mkdtempSync(join(tmpdir(), "airgap-monitoring-test-"));
  process.env.N8N_DB_PATH = join(dataDir, "database.sqlite");

  // The real app on a bare Fastify instance, wrapped in fastify-plugin only so its decorators are reachable from tests.
  const fastify = Fastify();
  await fastify.register(fp(app));
  await fastify.ready();

  onTestFinished(async () => {
    await fastify.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  return fastify;
}

export { build };
