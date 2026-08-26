import * as assert from "node:assert";
import { test } from "vitest";
import { build } from "../../../testing/build-app";

const URL = "/api/v1/instance-report";
const AUTHORIZED = { authorization: "Bearer test-token" };

const validReport = {
  instanceId: "instance-1",
  batchId: "batch-1",
  n8nVersion: "1.99.0",
  dataPoints: [
    { kind: "cumulative", name: "activeWorkflows", value: 87 },
    { kind: "cumulative", name: "successRate", value: 99.5 },
    {
      kind: "daily",
      name: "prodExecutions",
      value: 15234,
      date: "2026-03-25",
    },
  ],
};

test("stores an accepted instance report", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    headers: AUTHORIZED,
    payload: validReport,
  });

  assert.equal(res.statusCode, 201);

  const { id } = res.json() as { id: number };
  const row = app.db.prepare("SELECT * FROM instance_reports WHERE id = ?").get(id) as Record<string, string>;

  assert.equal(row.instance_id, "instance-1");
  assert.equal(row.batch_id, "batch-1");
  assert.equal(row.label, null);
  assert.equal(row.n8n_version, "1.99.0");
  assert.deepEqual(JSON.parse(row.data), validReport.dataPoints);
  assert.ok(!Number.isNaN(Date.parse(row.received_at)));
});

test("stores the optional label when provided", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    headers: AUTHORIZED,
    payload: { ...validReport, label: "Kiwi prod" },
  });

  assert.equal(res.statusCode, 201);

  const { id } = res.json() as { id: number };
  const row = app.db.prepare("SELECT label FROM instance_reports WHERE id = ?").get(id) as Record<string, string>;

  assert.equal(row.label, "Kiwi prod");
});

test("appends every report instead of overwriting the instance", async () => {
  const app = await build();

  for (const value of [10, 25]) {
    const res = await app.inject({
      method: "POST",
      url: URL,
      headers: AUTHORIZED,
      payload: {
        ...validReport,
        batchId: `batch-${value}`,
        dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value }],
      },
    });
    assert.equal(res.statusCode, 201);
  }

  const rows = app.db
    .prepare("SELECT data FROM instance_reports WHERE instance_id = ? ORDER BY id")
    .all("instance-1") as Array<{ data: string }>;

  assert.deepEqual(
    rows.map((row) => JSON.parse(row.data)[0].value),
    [10, 25],
  );
});

// The uniqueness guard is scoped per instance: two instances picking the same
// batchId are unrelated envelopes, and rejecting either would lose a report.
test("keeps envelopes that share a batchId across different instances", async () => {
  const app = await build();

  for (const instanceId of ["instance-1", "instance-2"]) {
    const res = await app.inject({
      method: "POST",
      url: URL,
      headers: AUTHORIZED,
      payload: { ...validReport, instanceId },
    });
    assert.equal(res.statusCode, 201);
  }

  const { count } = app.db.prepare("SELECT COUNT(*) AS count FROM instance_reports").get() as { count: number };

  assert.equal(count, 2);
});

test("rejects a request without a bearer token", async () => {
  const app = await build();

  const res = await app.inject({ method: "POST", url: URL, payload: validReport });

  assert.equal(res.statusCode, 401);
});

test("rejects a request with the wrong bearer token", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    headers: { authorization: "Bearer not-the-token" },
    payload: validReport,
  });

  assert.equal(res.statusCode, 401);
});

test("rejects malformed instance reports", async () => {
  const app = await build();

  const invalidPayloads: Record<string, unknown> = {
    "missing instanceId": { batchId: "batch-1", n8nVersion: "1.99.0", dataPoints: validReport.dataPoints },
    "empty instanceId": { ...validReport, instanceId: "" },
    "missing batchId": { instanceId: "instance-1", n8nVersion: "1.99.0", dataPoints: validReport.dataPoints },
    "empty batchId": { ...validReport, batchId: "" },
    "missing n8nVersion": { instanceId: "instance-1", batchId: "batch-1", dataPoints: validReport.dataPoints },
    "missing dataPoints": { instanceId: "instance-1", batchId: "batch-1", n8nVersion: "1.99.0" },
    "empty dataPoints": { ...validReport, dataPoints: [] },
    "string metric value": { ...validReport, dataPoints: [{ kind: "cumulative", name: "x", value: "15234" }] },
    "null metric value": { ...validReport, dataPoints: [{ kind: "cumulative", name: "x", value: null }] },
    "boolean metric value": { ...validReport, dataPoints: [{ kind: "cumulative", name: "x", value: true }] },
    "metric missing kind": { ...validReport, dataPoints: [{ name: "x", value: 1 }] },
    "metric with unknown kind": { ...validReport, dataPoints: [{ kind: "unknown", name: "x", value: 1 }] },
    "daily metric missing date": {
      ...validReport,
      dataPoints: [{ kind: "daily", name: "x", value: 1 }],
    },
    "non-calendar date": {
      ...validReport,
      dataPoints: [{ kind: "daily", name: "x", value: 1, date: "2026-02-30" }],
    },
    "timestamp instead of date": {
      ...validReport,
      dataPoints: [{ kind: "daily", name: "x", value: 1, date: "2026-03-25T00:00:00.000Z" }],
    },
    "empty label": { ...validReport, label: "" },
    "non-string label": { ...validReport, label: 42 },
    "oversized label": { ...validReport, label: "x".repeat(201) },
  };

  for (const [description, payload] of Object.entries(invalidPayloads)) {
    const res = await app.inject({
      method: "POST",
      url: URL,
      headers: AUTHORIZED,
      payload: payload as object,
    });

    assert.equal(res.statusCode, 400, `expected 400 for ${description}`);
  }

  const { count } = app.db.prepare("SELECT COUNT(*) AS count FROM instance_reports").get() as { count: number };

  assert.equal(count, 0);
});

test("ignores unknown top level fields so newer instances stay compatible", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    headers: AUTHORIZED,
    payload: { ...validReport, someFutureField: "ignored" },
  });

  assert.equal(res.statusCode, 201);
});

test("drops a metric level batchId left over from the pre-envelope shape", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    headers: AUTHORIZED,
    payload: {
      ...validReport,
      dataPoints: [{ kind: "daily", name: "prodExecutions", value: 1, batchId: "stale", date: "2026-03-25" }],
    },
  });

  assert.equal(res.statusCode, 201);

  const { id } = res.json() as { id: number };
  const row = app.db.prepare("SELECT data FROM instance_reports WHERE id = ?").get(id) as { data: string };

  // The envelope's batchId is the only one that carries meaning now, so the
  // stale one is stripped rather than stored alongside it.
  assert.deepEqual(JSON.parse(row.data), [{ kind: "daily", name: "prodExecutions", value: 1, date: "2026-03-25" }]);
});
