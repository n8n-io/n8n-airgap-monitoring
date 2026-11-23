import { expect, test } from "vitest";
import { build } from "../test-utils/build-app";
import { DuplicateBatchError, type InstanceReport, InstanceReportRepository } from "./instance-report.repository";

const event: InstanceReport = {
  instanceId: "instance-1",
  batchId: "batch-1",
  n8nVersion: "1.99.0",
  dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 7 }],
  receivedAt: "2026-03-25T00:00:00.000Z",
  consumerId: null,
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

test("findByInstanceId parses the stored data column back into metrics", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  await repository.insert({ ...event, label: "prod" });

  expect(await repository.findByInstanceId("instance-1")).toEqual([
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

test("findByInstanceId returns only that instance's events, oldest-first", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  await repository.insert({
    ...event,
    instanceId: "instance-2",
    batchId: "later",
    receivedAt: "2026-03-24T00:00:00.000Z",
  });
  await repository.insert({
    ...event,
    instanceId: "instance-1",
    batchId: "solo",
    receivedAt: "2026-03-25T00:00:00.000Z",
  });
  await repository.insert({
    ...event,
    instanceId: "instance-2",
    batchId: "earlier",
    receivedAt: "2026-03-23T00:00:00.000Z",
  });

  const rows = await repository.findByInstanceId("instance-2");

  expect(rows.map((r) => r.batchId)).toEqual(["earlier", "later"]);
});

test("findByInstanceId breaks a receivedAt tie by insertion order", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  const sameInstant = "2026-03-25T00:00:00.000Z";
  await repository.insert({ ...event, batchId: "first", receivedAt: sameInstant });
  await repository.insert({ ...event, batchId: "second", receivedAt: sameInstant });

  const rows = await repository.findByInstanceId("instance-1");

  expect(rows.map((r) => r.batchId)).toEqual(["first", "second"]);
});

test("findInstanceIds returns each distinct instanceId once, ascending", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  // Inserted out of order and with two rows for instance-b, to prove the query
  // sorts and de-duplicates rather than echoing the table.
  await repository.insert({ ...event, instanceId: "instance-b", batchId: "b1" });
  await repository.insert({ ...event, instanceId: "instance-a", batchId: "a1" });
  await repository.insert({ ...event, instanceId: "instance-b", batchId: "b2" });

  expect(await repository.findInstanceIds()).toEqual(["instance-a", "instance-b"]);
});

test("findInstanceIds narrows to the given instanceIds that are stored, ascending", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  for (const instanceId of ["instance-c", "instance-a", "instance-b"]) {
    await repository.insert({ ...event, instanceId, batchId: `${instanceId}-1` });
  }

  expect(await repository.findInstanceIds(["instance-c", "missing", "instance-a"])).toEqual([
    "instance-a",
    "instance-c",
  ]);
});

const CONSUMER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONSUMER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONSUMER_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("insert stores a consumerId and findConsumerIds reads it back", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  await repository.insert({ ...event, consumerId: CONSUMER_A });

  expect(await repository.findConsumerIds({})).toEqual([CONSUMER_A]);
});

test("findConsumerIds returns sorted distinct ids and skips null", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  await repository.insert({ ...event, instanceId: "instance-1", batchId: "b", consumerId: CONSUMER_B });
  await repository.insert({ ...event, instanceId: "instance-2", batchId: "a1", consumerId: CONSUMER_A });
  await repository.insert({ ...event, instanceId: "instance-2", batchId: "a2", consumerId: CONSUMER_A });
  await repository.insert({ ...event, instanceId: "instance-3", batchId: "none", consumerId: null });

  expect(await repository.findConsumerIds({})).toEqual([CONSUMER_A, CONSUMER_B]);
});

test("findConsumerIds honours the instance filter", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  await repository.insert({ ...event, instanceId: "instance-1", batchId: "a", consumerId: CONSUMER_A });
  await repository.insert({ ...event, instanceId: "instance-2", batchId: "b", consumerId: CONSUMER_B });

  expect(await repository.findConsumerIds({ instanceIds: ["instance-2"] })).toEqual([CONSUMER_B]);
});

test("findConsumerIds honours start and end against the receivedAt day", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.dataSource);

  await repository.insert({
    ...event,
    batchId: "before",
    receivedAt: "2026-09-30T23:59:59.999Z",
    consumerId: CONSUMER_A,
  });
  await repository.insert({
    ...event,
    batchId: "on-start",
    receivedAt: "2026-10-01T00:00:00.000Z",
    consumerId: CONSUMER_B,
  });
  await repository.insert({
    ...event,
    batchId: "on-end",
    receivedAt: "2026-10-31T23:59:59.999Z",
    consumerId: CONSUMER_C,
  });
  await repository.insert({
    ...event,
    batchId: "after",
    receivedAt: "2026-11-01T00:00:00.000Z",
    consumerId: CONSUMER_A,
  });

  expect(await repository.findConsumerIds({ start: "2026-10-01", end: "2026-10-31" })).toEqual([
    CONSUMER_B,
    CONSUMER_C,
  ]);
});
