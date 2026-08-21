// This file contains code that we reuse between our tests.
import Fastify from "fastify";
import fp from "fastify-plugin";
import { onTestFinished } from "vitest";
import app, { options } from "../app";

// Every test gets its own throwaway database, so nothing has to be cleaned up
// between runs and no test can observe another test's events.
process.env.N8N_INSTANCE_AUTH_TOKEN = "test-instance-token";
process.env.N8N_DASHBOARD_AUTH_TOKEN = "test-dashboard-token";
process.env.N8N_DB_PATH = ":memory:";

// Automatically build and tear down our instance
async function build() {
  // The app is built with the server options it exports, so tests validate
  // payloads under the same Ajv settings as production.
  const fastify = Fastify(options);

  // fastify-plugin ensures that all decorators are exposed for testing
  // purposes, this is different from the production setup.
  await fastify.register(fp(app));
  await fastify.ready();

  // Tear down our app after we are done
  onTestFinished(() => void fastify.close());

  return fastify;
}

export { build };
