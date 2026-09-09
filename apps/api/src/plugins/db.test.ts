import Fastify from "fastify";
import fp from "fastify-plugin";
import { expect, onTestFinished, test } from "vitest";
import app from "../app";
import { build } from "../testing/build-app";

// The durability decisions in adr/2026-09-09-node-sqlite3-via-n8n-typeorm.md
// are pragmas, which nothing else would catch if a driver or ORM upgrade
// silently changed them.
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

// A deployed volume already holds the table, created by a release that ran the
// schema SQL directly. Upgrading must adopt it, not fail on it or wipe it.
test("a second start against the same database file keeps its data and does not re-run migrations", async () => {
  const first = await build();
  await first.dataSource.query(
    `INSERT INTO instance_reports (instance_id, batch_id, n8n_version, data, received_at)
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
  expect(await second.dataSource.query("SELECT batch_id FROM instance_reports")).toEqual([{ batch_id: "batch-1" }]);
});
