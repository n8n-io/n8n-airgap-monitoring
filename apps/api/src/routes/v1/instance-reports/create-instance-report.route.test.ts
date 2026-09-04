import { expect, test } from "vitest";
import { build } from "../../../testing/build-app";

const URL = "/api/v1/instance-reports";
const AUTHORIZED = { authorization: "Bearer test-write-token" };

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

  expect(res.statusCode).toBe(201);

  const { id } = res.json() as { id: number };
  const row = app.db.prepare("SELECT * FROM instance_reports WHERE id = ?").get(id) as Record<string, string>;

  expect(row.instance_id).toBe("instance-1");
  expect(row.batch_id).toBe("batch-1");
  expect(row.label).toBe(null);
  expect(row.n8n_version).toBe("1.99.0");
  expect(JSON.parse(row.data)).toEqual(validReport.dataPoints);
  expect(Number.isNaN(Date.parse(row.received_at))).toBe(false);
});

test("stores the optional label when provided", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    headers: AUTHORIZED,
    payload: { ...validReport, label: "Kiwi prod" },
  });

  expect(res.statusCode).toBe(201);

  const { id } = res.json() as { id: number };
  const row = app.db.prepare("SELECT label FROM instance_reports WHERE id = ?").get(id) as Record<string, string>;

  expect(row.label).toBe("Kiwi prod");
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
    expect(res.statusCode).toBe(201);
  }

  const rows = app.db
    .prepare("SELECT data FROM instance_reports WHERE instance_id = ? ORDER BY id")
    .all("instance-1") as Array<{ data: string }>;

  expect(rows.map((row) => JSON.parse(row.data)[0].value)).toEqual([10, 25]);
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
    expect(res.statusCode).toBe(201);
  }

  const { count } = app.db.prepare("SELECT COUNT(*) AS count FROM instance_reports").get() as { count: number };

  expect(count).toBe(2);
});

test("rejects a repeated batchId as a conflict", async () => {
  const app = await build();

  const post = () => app.inject({ method: "POST", url: URL, headers: AUTHORIZED, payload: validReport });

  expect((await post()).statusCode).toBe(201);

  const res = await post();

  expect(res.statusCode).toBe(409);

  const { message } = res.json() as { message: string };

  expect(message).toContain("batch-1");
  // The client is told what it did, not how the store is built.
  expect(/SQLITE|UNIQUE/i.test(message)).toBe(false);

  const { count } = app.db
    .prepare("SELECT COUNT(*) AS count FROM instance_reports WHERE instance_id = ? AND batch_id = ?")
    .get("instance-1", "batch-1") as { count: number };

  expect(count).toBe(1);
});

test("rejects a request without a bearer token", async () => {
  const app = await build();

  const res = await app.inject({ method: "POST", url: URL, payload: validReport });

  expect(res.statusCode).toBe(401);
});

test("rejects a request with the wrong bearer token", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    headers: { authorization: "Bearer not-the-token" },
    payload: validReport,
  });

  expect(res.statusCode).toBe(401);
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

    expect(res.statusCode, `expected 400 for ${description}`).toBe(400);
  }

  const { count } = app.db.prepare("SELECT COUNT(*) AS count FROM instance_reports").get() as { count: number };

  expect(count).toBe(0);
});

test("ignores unknown top level fields so newer instances stay compatible", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    headers: AUTHORIZED,
    payload: { ...validReport, someFutureField: "ignored" },
  });

  expect(res.statusCode).toBe(201);
});
