import { DataSource } from "@n8n/typeorm";
import Fastify from "fastify";
import fp from "fastify-plugin";
import { expect, onTestFinished, test } from "vitest";
import app from "../app";
import { build } from "../testing/build-app";

test("opens the database in WAL mode with synchronous left at FULL", async () => {
  const { dataSource } = await build();

  expect(await dataSource.query("PRAGMA journal_mode")).toEqual([{ journal_mode: "wal" }]);
  // 2 is FULL. See https://www.sqlite.org/pragma.html#pragma_synchronous
  expect(await dataSource.query("PRAGMA synchronous")).toEqual([{ synchronous: 2 }]);
});

test("runs migrations on startup and records them once", async () => {
  const { dataSource } = await build();

  const applied = await dataSource.query("SELECT name FROM migrations ORDER BY id");

  expect(applied).toEqual([{ name: "CreateInstanceReports1788912000000" }]);
});

// Migrations are written by hand, so nothing else guarantees they produce the
// schema the entities describe. Let TypeORM build a throwaway database from
// the entities alone and compare what SQLite reports for both. A wrong column
// type, a missing index or a nullable mismatch shows up in the diff.
test("the migrated schema matches the entity definitions", async () => {
  const { dataSource } = await build();
  const fromEntities = new DataSource({
    type: "sqlite",
    database: ":memory:",
    entities: dataSource.options.entities,
    synchronize: true,
  });
  await fromEntities.initialize();
  onTestFinished(async () => {
    await fromEntities.destroy();
  });

  expect(await describeSchema(dataSource)).toEqual(await describeSchema(fromEntities));
});

// TypeORM's own differ (`createSchemaBuilder().log()`) would do this in one
// call, but it only recognises AUTOINCREMENT on a double-quoted column name in
// the stored CREATE TABLE text. Asking SQLite directly lets migrations keep
// their unquoted identifiers.
async function describeSchema(dataSource: DataSource) {
  const tables: { name: string }[] = await dataSource.query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('migrations', 'sqlite_sequence') ORDER BY name",
  );
  return Promise.all(
    tables.map(async ({ name }) => {
      const columns: { type: string }[] = await dataSource.query(`PRAGMA table_info(${name})`);
      const indexes: { name: string; unique: number; origin: string }[] = await dataSource.query(
        `PRAGMA index_list(${name})`,
      );
      return {
        name,
        // TypeORM writes lowercase type names, hand-written SQL usually does not.
        columns: columns.map((c) => ({ ...c, type: c.type.toLowerCase() })),
        // Skip the indexes SQLite creates for itself to back PRIMARY KEY and UNIQUE.
        indexes: indexes.filter((i) => i.origin === "c").sort((a, b) => a.name.localeCompare(b.name)),
      };
    }),
  );
}

// Every container restart is a second start against a populated file. The
// baseline migration is not idempotent on purpose, so this proves the
// bookkeeping keeps it from running twice.
test("a second start against the same database file keeps its data and does not re-run migrations", async () => {
  const first = await build();
  await first.dataSource.query(
    `INSERT INTO instance_reports (instanceId, batchId, n8nVersion, data, receivedAt)
     VALUES ('instance-1', 'batch-1', '1.99.0', '[]', '2026-03-25T00:00:00.000Z')`,
  );

  // build() left N8N_DB_PATH pointing at the first instance's file.
  const second = Fastify();
  await second.register(fp(app));
  await second.ready();
  onTestFinished(async () => {
    await second.close();
  });

  expect(await second.dataSource.query("SELECT COUNT(*) AS count FROM migrations")).toEqual([{ count: 1 }]);
  expect(await second.dataSource.query("SELECT batchId FROM instance_reports")).toEqual([{ batchId: "batch-1" }]);
});
