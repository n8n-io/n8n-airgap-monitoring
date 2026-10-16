import { existsSync } from "node:fs";
import { join } from "node:path";
import AjvCompiler from "@fastify/ajv-compiler";
import fastifyStatic from "@fastify/static";
import type { FastifyPluginAsync, FastifyServerOptions } from "fastify";
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

  // SPIKE (API-463): the submit page built from apps/submit. The image copies it to public/,
  // a local build reads it straight from apps/submit/dist.
  const submitRoot = [join(__dirname, "..", "public"), join(__dirname, "..", "..", "submit", "dist")].find((dir) =>
    existsSync(dir),
  );
  if (submitRoot !== undefined) {
    void fastify.register(fastifyStatic, {
      root: submitRoot,
      prefix: "/submit/",
      redirect: true,
      setHeaders: (res) => res.setHeader("x-frame-options", "DENY"),
    });
    fastify.get("/submit", async (_request, reply) => reply.redirect("/submit/"));
  }

  void fastify.register(healthRoutes);
  void fastify.register(v1Routes, { prefix: "/api/v1" });
};

export default app;
export { app };
