import { expect, test, vi } from "vitest";
import type { Metric, UsageReport } from "../../../instance-report/instance-report.service";
import { build } from "../../../testing/build-app";

const URL = "/api/v1/instance-reports";
const READ = { authorization: "Bearer test-read-token" };

type App = Awaited<ReturnType<typeof build>>;

/** Writes one stored event straight to the table, so a test controls received_at and order. */
function insertRow(
  app: App,
  row: {
    instanceId: string;
    batchId: string;
    label?: string | null;
    n8nVersion?: string;
    dataPoints: Metric[];
    receivedAt: string;
  },
): void {
  app.db
    .prepare(
      `INSERT INTO instance_reports (instance_id, batch_id, label, n8n_version, data, received_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.instanceId,
      row.batchId,
      row.label ?? null,
      row.n8nVersion ?? "1.99.0",
      JSON.stringify(row.dataPoints),
      row.receivedAt,
    );
}

test("rejects a request without a bearer token", async () => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: URL });

  expect(res.statusCode).toBe(401);
});

test("rejects a request with the wrong bearer token", async () => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: URL, headers: { authorization: "Bearer nope" } });

  expect(res.statusCode).toBe(401);
});

test("validates against the read token, not the write token", async () => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: URL, headers: { authorization: "Bearer test-write-token" } });

  expect(res.statusCode).toBe(401);
});

test("serves an empty report stamped with the generation time when nothing has been recorded", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-03T14:30:00.000Z"));

  try {
    const app = await build();

    const res = await app.inject({ method: "GET", url: URL, headers: READ });

    expect(res.statusCode).toBe(200);
    expect(res.json<UsageReport>()).toEqual({
      data: { generatedAt: "2026-09-03T14:30:00.000Z", instances: [] },
    });
  } finally {
    vi.useRealTimers();
  }
});

test("returns it as a named, uncacheable JSON download", async () => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: URL, headers: READ });

  expect(res.headers["content-type"]).toContain("application/json");
  expect(res.headers["cache-control"]).toBe("no-store");
  expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="n8n-instance-report-.*\.json"$/);
  // The flattened timestamp must not smuggle back a colon that breaks the filename.
  expect(res.headers["content-disposition"]).not.toContain(":");
});

test("reports each instance's id, first-seen day and full metric history", async () => {
  const app = await build();

  insertRow(app, {
    instanceId: "instance-1",
    batchId: "b1",
    label: "prod",
    dataPoints: [
      { kind: "daily", name: "billableExecutionPerDay", value: 100, date: "2026-03-24" },
      { kind: "cumulative", name: "billableExecutionTotal", value: 900000 },
    ],
    receivedAt: "2026-03-25T02:00:00.000Z",
  });
  insertRow(app, {
    instanceId: "instance-1",
    batchId: "b2",
    label: "prod-renamed",
    dataPoints: [
      { kind: "daily", name: "billableExecutionPerDay", value: 110, date: "2026-03-25" },
      { kind: "cumulative", name: "billableExecutionTotal", value: 900110 },
    ],
    receivedAt: "2026-03-26T02:00:00.000Z",
  });

  const res = await app.inject({ method: "GET", url: URL, headers: READ });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({
    data: {
      instances: [
        {
          instanceId: "instance-1",
          firstSeen: "2026-03-25",
          label: "prod-renamed",
          dataPoints: {
            billableExecutionPerDay: [
              { kind: "daily", date: "2026-03-24", value: 100, batchId: "b1", receivedAt: "2026-03-25T02:00:00.000Z" },
              { kind: "daily", date: "2026-03-25", value: 110, batchId: "b2", receivedAt: "2026-03-26T02:00:00.000Z" },
            ],
            billableExecutionTotal: [
              { kind: "cumulative", value: 900000, batchId: "b1", receivedAt: "2026-03-25T02:00:00.000Z" },
              { kind: "cumulative", value: 900110, batchId: "b2", receivedAt: "2026-03-26T02:00:00.000Z" },
            ],
          },
        },
      ],
    },
  });
});

test("keeps both values when a day is reported twice under different batchIds, instead of folding", async () => {
  const app = await build();

  insertRow(app, {
    instanceId: "shared",
    batchId: "from-a",
    dataPoints: [{ kind: "cumulative", name: "billableExecutionTotal", value: 900000 }],
    receivedAt: "2026-03-25T02:00:00.000Z",
  });
  insertRow(app, {
    instanceId: "shared",
    batchId: "from-b",
    dataPoints: [{ kind: "cumulative", name: "billableExecutionTotal", value: 300000 }],
    receivedAt: "2026-03-25T02:05:00.000Z",
  });

  const res = await app.inject({ method: "GET", url: URL, headers: READ });

  const { instances } = res.json<UsageReport>().data;
  expect(instances).toHaveLength(1);
  expect(instances[0].dataPoints).toEqual({
    billableExecutionTotal: [
      { kind: "cumulative", value: 900000, batchId: "from-a", receivedAt: "2026-03-25T02:00:00.000Z" },
      { kind: "cumulative", value: 300000, batchId: "from-b", receivedAt: "2026-03-25T02:05:00.000Z" },
    ],
  });
});

test("separates instances into their own entries", async () => {
  const app = await build();

  for (const instanceId of ["instance-1", "instance-2"]) {
    insertRow(app, {
      instanceId,
      batchId: `${instanceId}-b1`,
      dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 5 }],
      receivedAt: "2026-03-25T02:00:00.000Z",
    });
  }

  const res = await app.inject({ method: "GET", url: URL, headers: READ });

  const { instances } = res.json<UsageReport>().data;
  expect(instances.map((i) => i.instanceId).sort()).toEqual(["instance-1", "instance-2"]);
});

test("defaults a missing label to null", async () => {
  const app = await build();

  insertRow(app, {
    instanceId: "instance-1",
    batchId: "b1",
    dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 5 }],
    receivedAt: "2026-03-25T02:00:00.000Z",
  });

  const res = await app.inject({ method: "GET", url: URL, headers: READ });

  const { instances } = res.json<UsageReport>().data;
  expect(instances[0].label).toBeNull();
});
