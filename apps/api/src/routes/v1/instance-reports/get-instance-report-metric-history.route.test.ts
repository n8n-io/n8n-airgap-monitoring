import * as assert from "node:assert";
import { test } from "vitest";
import { build } from "../../../testing/build-app";

const DASHBOARD_AUTHORIZED = { authorization: "Bearer test-dashboard-token" };

function historyUrl(instanceId: string, metricName: string): string {
  return `/api/v1/instance-reports/${instanceId}/metrics/${metricName}/history`;
}

function insertReport(
  app: Awaited<ReturnType<typeof build>>,
  event: {
    instanceId: string;
    label?: string | null;
    n8nVersion: string;
    dataPoints: unknown[];
    receivedAt: string;
  },
): void {
  app.db
    .prepare(
      `INSERT INTO instance_reports (instance_id, label, n8n_version, data, received_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(event.instanceId, event.label ?? null, event.n8nVersion, JSON.stringify(event.dataPoints), event.receivedAt);
}

test("returns 404 for an instance that never reported", async () => {
  const app = await build();

  const res = await app.inject({
    method: "GET",
    url: historyUrl("unknown-instance", "prodExecutions"),
    headers: DASHBOARD_AUTHORIZED,
  });

  assert.equal(res.statusCode, 404);
});

test("returns 404 for a known instance that never reported that metric", async () => {
  const app = await build();

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 87 }],
    receivedAt: "2026-03-25T00:00:00.000Z",
  });

  const res = await app.inject({
    method: "GET",
    url: historyUrl("instance-1", "prodExecutions"),
    headers: DASHBOARD_AUTHORIZED,
  });

  assert.equal(res.statusCode, 404);
});

test("returns daily history sorted by date", async () => {
  const app = await build();

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "daily", name: "prodExecutions", value: 5, batchId: "batch-2", date: "2026-03-26" }],
    receivedAt: "2026-03-26T00:00:00.000Z",
  });

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "daily", name: "prodExecutions", value: 3, batchId: "batch-1", date: "2026-03-25" }],
    receivedAt: "2026-03-25T00:00:00.000Z",
  });

  const res = await app.inject({
    method: "GET",
    url: historyUrl("instance-1", "prodExecutions"),
    headers: DASHBOARD_AUTHORIZED,
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    data: {
      kind: "daily",
      points: [
        { date: "2026-03-25", value: 3, batchId: "batch-1" },
        { date: "2026-03-26", value: 5, batchId: "batch-2" },
      ],
    },
  });
});

test("dedupes a retried daily batchId, keeping the latest value", async () => {
  const app = await build();

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "daily", name: "prodExecutions", value: 3, batchId: "batch-1", date: "2026-03-25" }],
    receivedAt: "2026-03-25T00:00:00.000Z",
  });

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "daily", name: "prodExecutions", value: 4, batchId: "batch-1", date: "2026-03-25" }],
    receivedAt: "2026-03-25T01:00:00.000Z",
  });

  const res = await app.inject({
    method: "GET",
    url: historyUrl("instance-1", "prodExecutions"),
    headers: DASHBOARD_AUTHORIZED,
  });

  assert.deepEqual(res.json(), {
    data: {
      kind: "daily",
      points: [{ date: "2026-03-25", value: 4, batchId: "batch-1" }],
    },
  });
});

test("keeps both daily points when two instances share an instanceId on the same date", async () => {
  const app = await build();

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "daily", name: "prodExecutions", value: 3, batchId: "batch-a", date: "2026-03-25" }],
    receivedAt: "2026-03-25T00:00:00.000Z",
  });

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "daily", name: "prodExecutions", value: 9, batchId: "batch-b", date: "2026-03-25" }],
    receivedAt: "2026-03-25T00:05:00.000Z",
  });

  const res = await app.inject({
    method: "GET",
    url: historyUrl("instance-1", "prodExecutions"),
    headers: DASHBOARD_AUTHORIZED,
  });

  const {
    data: { points },
  } = res.json() as { data: { points: Array<{ batchId: string }> } };
  assert.deepEqual(
    points.map((p) => p.batchId),
    ["batch-a", "batch-b"],
  );
});

test("returns cumulative history in receipt order, allowing a regression", async () => {
  const app = await build();

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 10 }],
    receivedAt: "2026-03-25T00:00:00.000Z",
  });

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 4 }],
    receivedAt: "2026-03-26T00:00:00.000Z",
  });

  const res = await app.inject({
    method: "GET",
    url: historyUrl("instance-1", "activeWorkflows"),
    headers: DASHBOARD_AUTHORIZED,
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    data: {
      kind: "cumulative",
      points: [
        { receivedAt: "2026-03-25T00:00:00.000Z", value: 10 },
        { receivedAt: "2026-03-26T00:00:00.000Z", value: 4 },
      ],
    },
  });
});

test("filters out other metric names and other instances", async () => {
  const app = await build();

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.99.0",
    dataPoints: [
      { kind: "cumulative", name: "activeWorkflows", value: 10 },
      { kind: "cumulative", name: "otherMetric", value: 1 },
    ],
    receivedAt: "2026-03-25T00:00:00.000Z",
  });

  insertReport(app, {
    instanceId: "instance-2",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 999 }],
    receivedAt: "2026-03-25T00:00:00.000Z",
  });

  const res = await app.inject({
    method: "GET",
    url: historyUrl("instance-1", "activeWorkflows"),
    headers: DASHBOARD_AUTHORIZED,
  });

  assert.deepEqual(res.json(), {
    data: {
      kind: "cumulative",
      points: [{ receivedAt: "2026-03-25T00:00:00.000Z", value: 10 }],
    },
  });
});

test("rejects a request without a bearer token", async () => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: historyUrl("instance-1", "activeWorkflows") });

  assert.equal(res.statusCode, 401);
});

test("rejects a request with the wrong bearer token", async () => {
  const app = await build();

  const res = await app.inject({
    method: "GET",
    url: historyUrl("instance-1", "activeWorkflows"),
    headers: { authorization: "Bearer not-the-token" },
  });

  assert.equal(res.statusCode, 401);
});

test("rejects the instance auth token, since this route is dashboard-only", async () => {
  const app = await build();

  const res = await app.inject({
    method: "GET",
    url: historyUrl("instance-1", "activeWorkflows"),
    headers: { authorization: "Bearer test-instance-token" },
  });

  assert.equal(res.statusCode, 401);
});
