import { expect, test } from "vitest";
import { build } from "../testing/build-app";
import { DuplicateBatchError, type InstanceReport, InstanceReportRepository } from "./instance-report.repository";

const event: InstanceReport = {
  instanceId: "instance-1",
  batchId: "batch-1",
  n8nVersion: "1.99.0",
  dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 7 }],
  receivedAt: "2026-03-25T00:00:00.000Z",
};

// Built against the real database, because the point of the assertion is that
// the driver's constraint error is translated rather than escaping as-is.
test("translates a repeated batchId into a DuplicateBatchError", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  await repository.insert(event);

  await expect(repository.insert(event)).rejects.toThrow(DuplicateBatchError);
});

test("lets other constraint violations escape untranslated", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  // NOT NULL is the other constraint on the table; it must not be mistaken
  // for a duplicate.
  await expect(repository.insert({ ...event, n8nVersion: null as unknown as string })).rejects.not.toThrow(
    DuplicateBatchError,
  );
});

test("findAll parses the stored data column back into metrics", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  await repository.insert({ ...event, label: "prod" });

  expect(await repository.findAll()).toEqual([
    expect.objectContaining({
      instanceId: "instance-1",
      batchId: "batch-1",
      label: "prod",
      n8nVersion: "1.99.0",
      dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 7 }],
      receivedAt: "2026-03-25T00:00:00.000Z",
    }),
  ]);
});

test("an absent label is stored as NULL", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  await repository.insert(event);

  const [row] = await repository.findAll();
  expect(row.label).toBeNull();
});
