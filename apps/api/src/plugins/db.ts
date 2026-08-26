import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS instance_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id TEXT NOT NULL,
    batch_id    TEXT NOT NULL,
    label       TEXT,
    n8n_version TEXT NOT NULL,
    data        TEXT NOT NULL,
    received_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_instance_reports_instance
    ON instance_reports (instance_id, received_at DESC);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_instance_reports_batch
    ON instance_reports (instance_id, batch_id);
`;

/**
 * Opens the append-only event store.
 *
 * SQLite keeps the deployment a single container plus one volume, which matters
 * when the operator is a customer running this in an environment we cannot
 * reach. Thousands of instances reporting once a day is a trivial write load.
 */
export default fp(
  async (fastify: FastifyInstance) => {
    const { dbPath } = fastify.config;
    const isInMemory = dbPath === ":memory:";

    if (!isInMemory) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    const db = new Database(dbPath);

    if (!isInMemory) {
      // Lets a future reporting UI read while the daily report burst is written.
      db.pragma("journal_mode = WAL");
    }

    db.exec(SCHEMA);

    fastify.decorate("db", db);
    fastify.addHook("onClose", async () => {
      db.close();
    });
  },
  { name: "db", dependencies: ["config"] },
);

declare module "fastify" {
  export interface FastifyInstance {
    db: Database.Database;
  }
}
