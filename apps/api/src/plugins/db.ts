import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DataSource } from "@n8n/typeorm";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { migrations } from "../db/migrations";
import { InstanceReportEntity } from "../instance-report/instance-report.entity";

export default fp(
  async (fastify: FastifyInstance) => {
    const { dbPath } = fastify.config;

    mkdirSync(dirname(dbPath), { recursive: true });

    const dataSource = new DataSource({
      type: "sqlite",
      database: dbPath,
      // Readers do not block the writer, so a read endpoint stays responsive
      // while the daily report burst is being written.
      enableWAL: true,
      entities: [InstanceReportEntity],
      migrations,
      migrationsRun: true,
      migrationsTableName: "migrations",
      synchronize: false,
    });

    await dataSource.initialize();

    fastify.decorate("dataSource", dataSource);
    fastify.addHook("onClose", async () => {
      await dataSource.destroy();
    });
  },
  { name: "db", dependencies: ["config"] },
);

declare module "fastify" {
  export interface FastifyInstance {
    dataSource: DataSource;
  }
}
