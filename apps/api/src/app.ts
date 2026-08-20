import type { FastifyPluginAsync, FastifyServerOptions } from "fastify";
import config from "./plugins/config";
import db from "./plugins/db";
import sensible from "./plugins/sensible";
import ingest from "./routes/api/v1/ingest/index";
import root from "./routes/root";
import usage from "./usage/usage.plugin";

export interface AppOptions extends FastifyServerOptions {}

// Pass --options via CLI arguments in command to enable these options.
const options: AppOptions = {
  ajv: {
    customOptions: {
      // Ajv coerces by default, which would turn a null or boolean metric value
      // into 0 or 1 and silently write a wrong number into a usage metrid record.
      // Reports must be rejected instead, so operators can see the bad payload.
      coerceTypes: false,
    },
  },
};

const app: FastifyPluginAsync<AppOptions> = async (fastify, _opts): Promise<void> => {
  void fastify.register(config);
  void fastify.register(db);
  void fastify.register(sensible);

  // Feature modules wire themselves up and are registered explicitly, so a
  // module keeps its plugin next to the service and repository it composes.
  void fastify.register(usage);

  void fastify.register(root);
  void fastify.register(ingest, { prefix: "/api/v1/ingest" });
};

export default app;
export { app, options };
