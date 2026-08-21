import * as assert from "node:assert";
import { test } from "vitest";
import { build } from "../../../testing/build-app";

const URL = "/api/v1/instance-reports";
const DASHBOARD_AUTHORIZED = { authorization: "Bearer test-dashboard-token" };

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

test("returns an empty list when no instance has reported", async () => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: URL, headers: DASHBOARD_AUTHORIZED });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { data: { instances: [] } });
});

test("summarizes a single instance from a single report", async () => {
  const app = await build();

  insertReport(app, {
    instanceId: "instance-1",
    label: "Kiwi prod",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 87 }],
    receivedAt: "2026-03-25T00:00:00.000Z",
  });

  const res = await app.inject({ method: "GET", url: URL, headers: DASHBOARD_AUTHORIZED });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    data: {
      instances: [
        {
          instanceId: "instance-1",
          label: "Kiwi prod",
          n8nVersion: "1.99.0",
          receivedAt: "2026-03-25T00:00:00.000Z",
          metrics: { activeWorkflows: 87 },
        },
      ],
    },
  });
});

test("merges metrics across an instance's full report history", async () => {
  const app = await build();

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.99.0",
    dataPoints: [
      { kind: "cumulative", name: "a", value: 1 },
      { kind: "cumulative", name: "b", value: 2 },
    ],
    receivedAt: "2026-03-25T00:00:00.000Z",
  });

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.100.0",
    dataPoints: [{ kind: "cumulative", name: "a", value: 5 }],
    receivedAt: "2026-03-26T00:00:00.000Z",
  });

  const res = await app.inject({ method: "GET", url: URL, headers: DASHBOARD_AUTHORIZED });

  const {
    data: { instances },
  } = res.json() as { data: { instances: Array<{ metrics: Record<string, number> }> } };
  assert.deepEqual(instances[0]?.metrics, { a: 5, b: 2 });
});

test("clears a previously-set label when a later report omits it", async () => {
  const app = await build();

  insertReport(app, {
    instanceId: "instance-1",
    label: "Kiwi prod",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "cumulative", name: "a", value: 1 }],
    receivedAt: "2026-03-25T00:00:00.000Z",
  });

  insertReport(app, {
    instanceId: "instance-1",
    n8nVersion: "1.100.0",
    dataPoints: [{ kind: "cumulative", name: "a", value: 2 }],
    receivedAt: "2026-03-26T00:00:00.000Z",
  });

  const res = await app.inject({ method: "GET", url: URL, headers: DASHBOARD_AUTHORIZED });

  const {
    data: { instances },
  } = res.json() as { data: { instances: Array<{ label: string | null }> } };
  assert.equal(instances[0]?.label, null);
});

test("returns multiple instances ordered by instanceId, each with independent metrics", async () => {
  const app = await build();

  insertReport(app, {
    instanceId: "instance-b",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "cumulative", name: "x", value: 1 }],
    receivedAt: "2026-03-25T00:00:00.000Z",
  });

  insertReport(app, {
    instanceId: "instance-a",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "cumulative", name: "y", value: 2 }],
    receivedAt: "2026-03-25T00:00:00.000Z",
  });

  const res = await app.inject({ method: "GET", url: URL, headers: DASHBOARD_AUTHORIZED });

  const {
    data: { instances },
  } = res.json() as { data: { instances: Array<{ instanceId: string; metrics: Record<string, number> }> } };
  assert.deepEqual(
    instances.map((instance) => instance.instanceId),
    ["instance-a", "instance-b"],
  );
  assert.deepEqual(instances[0]?.metrics, { y: 2 });
  assert.deepEqual(instances[1]?.metrics, { x: 1 });
});

test("rejects a request without a bearer token", async () => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: URL });

  assert.equal(res.statusCode, 401);
});

test("rejects a request with the wrong bearer token", async () => {
  const app = await build();

  const res = await app.inject({
    method: "GET",
    url: URL,
    headers: { authorization: "Bearer not-the-token" },
  });

  assert.equal(res.statusCode, 401);
});

test("rejects the instance auth token, since this route is dashboard-only", async () => {
  const app = await build();

  const res = await app.inject({
    method: "GET",
    url: URL,
    headers: { authorization: "Bearer test-instance-token" },
  });

  assert.equal(res.statusCode, 401);
});
