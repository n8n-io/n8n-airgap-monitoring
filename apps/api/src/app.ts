import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import AjvCompiler from "@fastify/ajv-compiler";
import fastifyStatic from "@fastify/static";
import type { FastifyPluginAsync, FastifyServerOptions } from "fastify";
import { contentSecurityPolicy } from "./content-security-policy";
import instanceReport from "./instance-report/instance-report.plugin";
import config from "./plugins/config";
import db from "./plugins/db";
import reportAuth from "./plugins/report-auth";
import sensible from "./plugins/sensible";
import { healthRoutes } from "./routes/health";
import v1Routes from "./routes/v1";
import submissions from "./submissions/submissions.plugin";

export interface AppOptions extends FastifyServerOptions {}

const app: FastifyPluginAsync<AppOptions> = async (fastify, _opts): Promise<void> => {
  fastify.setValidatorCompiler(
    AjvCompiler()(
      {},
      {
        customOptions: {
          /**
           * Ajv coerces by default, which would turn a null or boolean metric value
           * into 0 or 1 and silently write a wrong number into a instance report metric record.
           * Reports must be rejected instead, so operators can see the bad payload.
           */
          coerceTypes: false,
        },
      },
    ),
  );

  void fastify.register(config);
  void fastify.register(db);
  void fastify.register(sensible);
  void fastify.register(reportAuth);

  // Feature modules wire themselves up and are registered explicitly, so a
  // module keeps its plugin next to the service and repository it composes.
  void fastify.register(instanceReport);
  void fastify.register(submissions);

  // The submit page. packages/submit-ui builds it to its dist/, which
  // ships in node_modules. Unbuilt (e.g. under the unit tests) the API runs without it.
  const submitRoot = join(dirname(require.resolve("submit-ui/package.json")), "dist");
  // It is the service's only UI, so it sits at the root
  if (existsSync(submitRoot)) {
    void fastify.register(fastifyStatic, {
      root: submitRoot,
      setHeaders: (res) => {
        res.setHeader("x-frame-options", "DENY");
        // A header, not a <meta> tag in the built page: the destination is only known at start-up.
        res.setHeader("content-security-policy", contentSecurityPolicy(fastify.config.reportDestination));
      },
    });
  } else {
    fastify.log.warn("submit-ui is not built, / serves no page");
  }

  void fastify.register(healthRoutes);
  void fastify.register(v1Routes, { prefix: "/api/v1" });
};

export default app;
export { app };
