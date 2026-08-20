import { join } from 'node:path'
import AutoLoad, { AutoloadPluginOptions } from '@fastify/autoload'
import { FastifyPluginAsync, FastifyServerOptions } from 'fastify'
import usage from './usage/usage.plugin'

export interface AppOptions extends FastifyServerOptions, Partial<AutoloadPluginOptions> {

}

// Tests live next to the code they cover, so the autoloaded directories contain
// test files that must not be registered as plugins or routes.
const TEST_FILES = /\.test\.(?:ts|js)$/
// Pass --options via CLI arguments in command to enable these options.
const options: AppOptions = {
  ajv: {
    customOptions: {
      // Ajv coerces by default, which would turn a null or boolean metric value
      // into 0 or 1 and silently write a wrong number into a usage metrid record.
      // Reports must be rejected instead, so operators can see the bad payload.
      coerceTypes: false
    }
  }
}

const app: FastifyPluginAsync<AppOptions> = async (
  fastify,
  opts
): Promise<void> => {
  // Place here your custom code!

  // Do not touch the following lines

  // This loads all plugins defined in plugins
  // those should be support plugins that are reused
  // through your application
  // eslint-disable-next-line no-void
  void fastify.register(AutoLoad, {
    dir: join(__dirname, 'plugins'),
    options: opts,
    ignorePattern: TEST_FILES
  })

  // Feature modules wire themselves up and are registered explicitly, so a
  // module keeps its plugin next to the service and repository it composes.
  // eslint-disable-next-line no-void
  void fastify.register(usage)

  // This loads all plugins defined in routes
  // define your routes in one of these
  // eslint-disable-next-line no-void
  void fastify.register(AutoLoad, {
    dir: join(__dirname, 'routes'),
    options: opts,
    ignorePattern: TEST_FILES
  })
}

export default app
export { app, options }
