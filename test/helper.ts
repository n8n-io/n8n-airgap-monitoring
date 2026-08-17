// This file contains code that we reuse between our tests.
import * as path from 'node:path'
import * as test from 'node:test'
const helper = require('fastify-cli/helper.js')

export type TestContext = {
  after: typeof test.after
}

const AppPath = path.join(__dirname, '..', 'src', 'app.ts')

// Every test gets its own throwaway database, so nothing has to be cleaned up
// between runs and no test can observe another test's events.
process.env.N8N_AUTH_TOKEN = 'test-token'
process.env.N8N_DB_PATH = ':memory:'

// Fill in this config with all the configurations
// needed for testing the application
function config () {
  return {
    skipOverride: true // Register our application with fastify-plugin
  }
}

// Automatically build and tear down our instance
async function build (t: TestContext) {
  // you can set all the options supported by the fastify CLI command.
  // --options makes the CLI apply the server options exported by app.ts, so
  // tests validate payloads under the same Ajv settings as production.
  const argv = [AppPath, '--options']

  // fastify-plugin ensures that all decorators
  // are exposed for testing purposes, this is
  // different from the production setup
  const app = await helper.build(argv, config())

  // Tear down our app after we are done
  // eslint-disable-next-line no-void
  t.after(() => void app.close())

  return app
}

export {
  config,
  build
}
