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
// Reports authenticate with either credential. The write token is set so the
// bearer path is testable; the test CA is trusted once here, so every test
// mints certificates through mock-license.ts and nothing else. The auth
// plugin honours TEST_LICENSE_ISSUER_CERT only under NODE_ENV=test, which the
// Vitest config pins.
process.env.N8N_MONITORING_WRITE_TOKEN = "test-write-token";
process.env.TEST_LICENSE_ISSUER_CERT = TEST_ISSUER_CERT_PEM;

// Automatically build and tear down our instance
async function build() {
  // Every test gets its own throwaway database file, so no test can observe
  // another test's events.
  const dataDir = mkdtempSync(join(tmpdir(), "cmfae-test-"));
  process.env.N8N_DB_PATH = join(dataDir, "database.sqlite");

  // The app sets its own validator compiler, so tests validate payloads under
  // the same Ajv settings as production without configuring anything here.
  const fastify = Fastify();

  // fastify-plugin ensures that all decorators are exposed for testing
  // purposes, this is different from the production setup.
  await fastify.register(fp(app));
  await fastify.ready();

  // Tear down our app after we are done
  onTestFinished(async () => {
    await fastify.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  return fastify;
}

export { build };
