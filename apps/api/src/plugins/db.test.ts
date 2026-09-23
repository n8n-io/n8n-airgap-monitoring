import Fastify from "fastify";
import fp from "fastify-plugin";
import { expect, onTestFinished, test } from "vitest";
import app from "../app";
import { build } from "../test-utils/build-app";

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
