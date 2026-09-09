import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DataSource } from "@n8n/typeorm";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { migrations } from "../db/migrations";
import { InstanceReportEntity } from "../instance-report/instance-report.entity";

/**
 * Opens the append-only event store and brings its schema up to date.
 *
 * SQLite keeps the deployment a single container plus one volume, which matters
 * when the operator is a customer running this in an environment we cannot
 * reach. Access goes through n8n's TypeORM fork and the `sqlite3` driver it
 * requires, so this service shares n8n's data layer; see
 * adr/2026-09-09-node-sqlite3-via-n8n-typeorm.md for what that changes.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    const { dbPath } = fastify.config;

    mkdirSync(dirname(dbPath), { recursive: true });

    const dataSource = new DataSource({
      type: "sqlite",
      database: dbPath,
      // Readers do not block the writer, so a read endpoint stays responsive
      // while the daily report burst is being written. `synchronous` is left
      // at SQLite's default of FULL on purpose: a 201 must mean the report
      // survives power loss.
      enableWAL: true,
      entities: [InstanceReportEntity],
      // Schema changes ship as migrations and run on every start, so an
      // upgraded container needs no operator step. Never let TypeORM derive
      // schema changes from the entities on its own.
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
