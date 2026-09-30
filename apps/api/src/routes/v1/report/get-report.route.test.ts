import { describe, expect, test, vi } from "vitest";
import type { Metric, UsageReport } from "../../../instance-report/instance-report.service";
import { build } from "../../../test-utils/build-app";

const URL = "/api/v1/report";
const READ = { authorization: "Bearer test-read-token" };

type App = Awaited<ReturnType<typeof build>>;

/** Writes one stored event straight to the table, so a test controls receivedAt and order. */
async function insertRow(
  app: App,
  row: {
    instanceId: string;
    batchId: string;
    label?: string | null;
    n8nVersion?: string;
    dataPoints: Metric[];
    receivedAt: string;
  },
): Promise<void> {
  await app.dataSource.query(
    `INSERT INTO instance_reports (instanceId, batchId, label, n8nVersion, data, receivedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      row.instanceId,
      row.batchId,
      row.label ?? null,
      row.n8nVersion ?? "1.99.0",
      JSON.stringify(row.dataPoints),
      row.receivedAt,
    ],
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
      data: { generatedAt: "2026-09-03T14:30:00.000Z", filters: "", instances: [] },
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

  await insertRow(app, {
    instanceId: "instance-1",
    batchId: "b1",
    label: "prod",
    dataPoints: [
      { kind: "daily", name: "billableExecutions", value: 100, date: "2026-03-24" },
      { kind: "cumulative", name: "billableExecutions", value: 900000 },
    ],
    receivedAt: "2026-03-25T02:00:00.000Z",
  });
  await insertRow(app, {
    instanceId: "instance-1",
    batchId: "b2",
    label: "prod-renamed",
    dataPoints: [
      { kind: "daily", name: "billableExecutions", value: 110, date: "2026-03-25" },
      { kind: "cumulative", name: "billableExecutions", value: 900110 },
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
          firstSeen: "2026-03-25T02:00:00.000Z",
          lastReportAt: "2026-03-26T02:00:00.000Z",
          label: "prod-renamed",
          dataPoints: {
            billableExecutions: [
              { kind: "daily", date: "2026-03-24", value: 100, batchId: "b1", receivedAt: "2026-03-25T02:00:00.000Z" },
              { kind: "cumulative", value: 900000, batchId: "b1", receivedAt: "2026-03-25T02:00:00.000Z" },
              { kind: "daily", date: "2026-03-25", value: 110, batchId: "b2", receivedAt: "2026-03-26T02:00:00.000Z" },
              { kind: "cumulative", value: 900110, batchId: "b2", receivedAt: "2026-03-26T02:00:00.000Z" },
            ],
          },
        },
      ],
    },
  });
});

test("keeps conflicting cumulative values from two batchIds on one instance, instead of folding to latest", async () => {
  const app = await build();

  await insertRow(app, {
    instanceId: "shared",
    batchId: "from-a",
    dataPoints: [{ kind: "cumulative", name: "billableExecutions", value: 900000 }],
    receivedAt: "2026-03-25T02:00:00.000Z",
  });
  await insertRow(app, {
    instanceId: "shared",
    batchId: "from-b",
    dataPoints: [{ kind: "cumulative", name: "billableExecutions", value: 300000 }],
    receivedAt: "2026-03-25T02:05:00.000Z",
  });

  const res = await app.inject({ method: "GET", url: URL, headers: READ });

  const { instances } = res.json<UsageReport>().data;
  expect(instances).toHaveLength(1);
  expect(instances[0].dataPoints).toEqual({
    billableExecutions: [
      { kind: "cumulative", value: 900000, batchId: "from-a", receivedAt: "2026-03-25T02:00:00.000Z" },
      { kind: "cumulative", value: 300000, batchId: "from-b", receivedAt: "2026-03-25T02:05:00.000Z" },
    ],
  });
});

test("separates instances into their own entries", async () => {
  const app = await build();

  for (const instanceId of ["instance-1", "instance-2"]) {
    await insertRow(app, {
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

  await insertRow(app, {
    instanceId: "instance-1",
    batchId: "b1",
    dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 5 }],
    receivedAt: "2026-03-25T02:00:00.000Z",
  });

  const res = await app.inject({ method: "GET", url: URL, headers: READ });

  const { instances } = res.json<UsageReport>().data;
  expect(instances[0].label).toBeNull();
});

test("streams a body that parses as valid JSON across multiple instances", async () => {
  const app = await build();

  // Several instances, each with more than one point, so the hand-assembled
  // envelope (head + one JSON.stringify per instance + separating commas + tail)
  // is exercised where a missing or extra comma would break parsing.
  for (const instanceId of ["a", "b", "c"]) {
    await insertRow(app, {
      instanceId,
      batchId: `${instanceId}-b1`,
      dataPoints: [
        { kind: "daily", name: "billableExecutions", value: 10, date: "2026-03-24" },
        { kind: "cumulative", name: "billableExecutions", value: 100 },
      ],
      receivedAt: "2026-03-25T02:00:00.000Z",
    });
  }

  const res = await app.inject({ method: "GET", url: URL, headers: READ });

  expect(res.statusCode).toBe(200);
  // Parse the raw streamed bytes directly (not via res.json()), so this asserts
  // the stream itself is well-formed JSON rather than trusting a helper to cope.
  const parsed = JSON.parse(res.body) as UsageReport;
  expect(parsed.data.instances.map((i) => i.instanceId)).toEqual(["a", "b", "c"]);
});

/** One minimal event per instance, so a filter test can tell which instances came back. */
async function seedInstances(app: App, instanceIds: string[]): Promise<void> {
  for (const instanceId of instanceIds) {
    await insertRow(app, {
      instanceId,
      batchId: `${instanceId}-b1`,
      dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 5 }],
      receivedAt: "2026-03-25T02:00:00.000Z",
    });
  }
}

async function getReport(app: App, query: string) {
  const res = await app.inject({ method: "GET", url: `${URL}${query}`, headers: READ });
  return { res, data: res.statusCode === 200 ? (JSON.parse(res.body) as UsageReport).data : undefined };
}

describe("filtering by instanceId", () => {
  test("narrows to a single instanceId and lists it in filters", async () => {
    const app = await build();
    await seedInstances(app, ["a", "b", "c"]);

    const { res, data } = await getReport(app, "?instanceId=b");

    expect(res.statusCode).toBe(200);
    expect(data?.instances.map((i) => i.instanceId)).toEqual(["b"]);
    expect(data?.filters).toBe("instanceId=b");
  });

  test("narrows to a repeated instanceId, listed sorted in filters", async () => {
    const app = await build();
    await seedInstances(app, ["a", "b", "c"]);

    const { data } = await getReport(app, "?instanceId=c&instanceId=a");

    expect(data?.instances.map((i) => i.instanceId)).toEqual(["a", "c"]);
    expect(data?.filters).toBe("instanceId=a&instanceId=c");
  });

  test("lists a duplicated value once", async () => {
    const app = await build();
    await seedInstances(app, ["a", "b"]);

    const { data } = await getReport(app, "?instanceId=a&instanceId=a");

    expect(data?.instances.map((i) => i.instanceId)).toEqual(["a"]);
    expect(data?.filters).toBe("instanceId=a");
  });

  test("does not split a value on commas", async () => {
    const app = await build();
    await seedInstances(app, ["a", "b", "a,b"]);

    const { data } = await getReport(app, "?instanceId=a,b");

    expect(data?.instances.map((i) => i.instanceId)).toEqual(["a,b"]);
  });

  test("serves an empty report for an unknown instanceId", async () => {
    const app = await build();
    await seedInstances(app, ["a"]);

    const { res, data } = await getReport(app, "?instanceId=nope");

    expect(res.statusCode).toBe(200);
    expect(data?.instances).toEqual([]);
    expect(data?.filters).toBe("instanceId=nope");
  });

  test("encodes filters so they can be replayed as the query string", async () => {
    const app = await build();
    const awkward = "prod a&b=c/ü";
    await seedInstances(app, [awkward, "other"]);

    const first = await getReport(app, `?instanceId=${encodeURIComponent(awkward)}`);
    const replayed = await getReport(app, `?${first.data?.filters}`);

    expect(first.data?.instances.map((i) => i.instanceId)).toEqual([awkward]);
    expect(replayed.data?.instances.map((i) => i.instanceId)).toEqual([awkward]);
    expect(replayed.data?.filters).toBe(first.data?.filters);
  });

  test("ignores an unknown query parameter and reports no filters", async () => {
    const app = await build();
    await seedInstances(app, ["a", "b"]);

    // A typo'd parameter name: the empty filters is how a reader notices nothing was applied.
    const { res, data } = await getReport(app, "?instanceid=a");

    expect(res.statusCode).toBe(200);
    expect(data?.instances.map((i) => i.instanceId)).toEqual(["a", "b"]);
    expect(data?.filters).toBe("");
  });

  test("rejects an empty instanceId", async () => {
    const app = await build();

    const { res } = await getReport(app, "?instanceId=");

    expect(res.statusCode).toBe(400);
  });

  test("rejects an instanceId longer than an instance can report", async () => {
    const app = await build();

    const { res } = await getReport(app, `?instanceId=${"x".repeat(257)}`);

    expect(res.statusCode).toBe(400);
  });

  test("accepts 100 instanceIds and rejects 101", async () => {
    const app = await build();
    const query = (n: number) => `?${Array.from({ length: n }, (_, i) => `instanceId=i${i}`).join("&")}`;

    expect((await getReport(app, query(100))).res.statusCode).toBe(200);
    expect((await getReport(app, query(101))).res.statusCode).toBe(400);
  });

  test("still requires the read token", async () => {
    const app = await build();

    const res = await app.inject({ method: "GET", url: `${URL}?instanceId=a` });

    expect(res.statusCode).toBe(401);
  });
});
