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
  const repository = new InstanceReportRepository(app.db);

  repository.insert(event);

  expect(() => repository.insert(event)).toThrow(DuplicateBatchError);
});

test("findByInstance parses the stored data column back into metrics", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.db);

  repository.insert({ ...event, label: "prod" });

  expect(repository.findByInstance("instance-1")).toEqual([
    {
      instanceId: "instance-1",
      batchId: "batch-1",
      label: "prod",
      n8nVersion: "1.99.0",
      dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 7 }],
      receivedAt: "2026-03-25T00:00:00.000Z",
    },
  ]);
});

test("findByInstance returns one instance's events, oldest-first", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.db);

  repository.insert({ ...event, instanceId: "instance-2", batchId: "later", receivedAt: "2026-03-24T00:00:00.000Z" });
  repository.insert({ ...event, instanceId: "instance-1", batchId: "solo", receivedAt: "2026-03-25T00:00:00.000Z" });
  repository.insert({ ...event, instanceId: "instance-2", batchId: "earlier", receivedAt: "2026-03-23T00:00:00.000Z" });

  expect(repository.findByInstance("instance-2").map((r) => r.batchId)).toEqual(["earlier", "later"]);
  expect(repository.findByInstance("instance-1").map((r) => r.batchId)).toEqual(["solo"]);
});

test("findByInstance breaks a received_at tie by insertion order", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.db);

  const sameInstant = "2026-03-25T00:00:00.000Z";
  repository.insert({ ...event, batchId: "first", receivedAt: sameInstant });
  repository.insert({ ...event, batchId: "second", receivedAt: sameInstant });

  expect(repository.findByInstance("instance-1").map((r) => r.batchId)).toEqual(["first", "second"]);
});

test("findInstanceIds lists each reporting instance once, in a stable order", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.db);

  repository.insert({ ...event, instanceId: "instance-2", batchId: "b1" });
  repository.insert({ ...event, instanceId: "instance-1", batchId: "b2" });
  repository.insert({ ...event, instanceId: "instance-2", batchId: "b3" });

  expect(repository.findInstanceIds()).toEqual(["instance-1", "instance-2"]);
});

test("findInstanceIds is empty for an empty table", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.db);

  expect(repository.findInstanceIds()).toEqual([]);
});
