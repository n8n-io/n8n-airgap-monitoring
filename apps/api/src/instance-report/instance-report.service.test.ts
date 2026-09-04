import { expect, test, vi } from "vitest";
import type { InstanceReport, InstanceReportRepository, InstanceReportRow } from "./instance-report.repository";
import {
  type CreateInstanceReport,
  InstanceReportService,
  type Metric,
  type UsageReport,
} from "./instance-report.service";

const report: CreateInstanceReport = {
  instanceId: "instance-1",
  batchId: "batch-1",
  n8nVersion: "1.99.0",
  dataPoints: [
    { kind: "cumulative", name: "activeWorkflows", value: 7 },
    {
      kind: "daily",
      name: "prodExecutions",
      value: 42,
      date: "2026-03-25",
    },
  ],
};

/** Records what the service hands down, so the rules can be asserted directly. */
function fakeRepository() {
  const inserted: InstanceReport[] = [];

  const repository = {
    insert(event: InstanceReport) {
      inserted.push(event);
      return inserted.length;
    },
  };

  return { inserted, repository: repository as unknown as InstanceReportRepository };
}

test("stamps the arrival time itself", async () => {
  const { inserted, repository } = fakeRepository();

  new InstanceReportService(repository).recordReport(report);

  expect(inserted.length).toBe(1);
  expect(Number.isNaN(Date.parse(inserted[0].receivedAt))).toBe(false);
});

test("passes the reporting instance's batchId through untouched", async () => {
  const { inserted, repository } = fakeRepository();

  new InstanceReportService(repository).recordReport(report);

  expect(inserted[0].batchId).toBe("batch-1");
});

test("returns the id assigned by the repository", async () => {
  const { repository } = fakeRepository();
  const service = new InstanceReportService(repository);

  expect(service.recordReport(report)).toEqual({ id: 1 });
  expect(service.recordReport(report)).toEqual({ id: 2 });
});

/**
 * A repository stub serving pre-built rows through the per-instance read API, grouped
 * the way the real ORDER BY would group them.
 */
function fakeReportRepository(rows: InstanceReportRow[]): InstanceReportService {
  const byInstance = Map.groupBy(rows, (row) => row.instanceId);

  return new InstanceReportService({
    findInstanceIds: () => [...byInstance.keys()],
    findByInstance: (instanceId: string) => byInstance.get(instanceId) ?? [],
  } as unknown as InstanceReportRepository);
}

/** Collects the stream into the document it describes, so shape assertions read as one object. */
function reportFrom(rows: InstanceReportRow[]): UsageReport {
  const { generatedAt, entries } = fakeReportRepository(rows).reportStream();

  return { data: { generatedAt, instances: [...entries] } };
}

function row(overrides: Partial<InstanceReportRow>): InstanceReportRow {
  return {
    instanceId: "instance-1",
    batchId: "batch-1",
    label: null,
    n8nVersion: "1.99.0",
    dataPoints: [],
    receivedAt: "2026-03-25T02:00:00.000Z",
    ...overrides,
  };
}

test("the report takes firstSeen from the earliest row, and label and lastReportAt from the latest", () => {
  const report = reportFrom([
    row({ batchId: "b1", label: "first", receivedAt: "2026-03-20T02:00:00.000Z" }),
    row({ batchId: "b2", label: "latest", receivedAt: "2026-03-25T02:00:00.000Z" }),
  ]);

  expect(report.data.instances[0].firstSeen).toBe("2026-03-20");
  expect(report.data.instances[0].label).toBe("latest");
  expect(report.data.instances[0].lastReportAt).toBe("2026-03-25T02:00:00.000Z");
});

test("the report files a metric named __proto__ as data instead of crashing", () => {
  const protoKey = "__proto__";
  const report = reportFrom([row({ dataPoints: [{ kind: "cumulative", name: protoKey, value: 5 }] })]);

  expect(report.data.instances[0].dataPoints[protoKey]).toEqual([
    { kind: "cumulative", value: 5, batchId: "batch-1", receivedAt: "2026-03-25T02:00:00.000Z" },
  ]);
});

// Nothing validates the response on its way out any more, so the union is pinned here:
// a daily point carries the day it covers and a cumulative one carries none.
test("the report gives a daily point its date and a cumulative point none", () => {
  const report = reportFrom([
    row({
      dataPoints: [
        { kind: "daily", name: "perDay", value: 1, date: "2026-03-24" },
        { kind: "cumulative", name: "total", value: 2 },
      ],
    }),
  ]);

  expect(report.data.instances[0].dataPoints).toEqual({
    perDay: [
      { kind: "daily", date: "2026-03-24", value: 1, batchId: "batch-1", receivedAt: "2026-03-25T02:00:00.000Z" },
    ],
    total: [{ kind: "cumulative", value: 2, batchId: "batch-1", receivedAt: "2026-03-25T02:00:00.000Z" }],
  });
});

// The stored `data` column is parsed JSON, so a row written by a different version —
// or by hand — can hold fields this code has never heard of. They stay out of the
// export: nothing validates the response on its way out to strip them.
test("the report carries only the fields it knows, whatever the stored point holds", () => {
  const stored = [
    { kind: "cumulative", name: "total", value: 5, internalNote: "leaked", date: "2026-03-24" },
  ] as unknown as Metric[];

  const report = reportFrom([row({ dataPoints: stored })]);

  expect(report.data.instances[0].dataPoints.total).toEqual([
    { kind: "cumulative", value: 5, batchId: "batch-1", receivedAt: "2026-03-25T02:00:00.000Z" },
  ]);
});

test("the report separates instances into their own entries", () => {
  const report = reportFrom([
    row({ instanceId: "instance-1", batchId: "b1" }),
    row({ instanceId: "instance-2", batchId: "b2" }),
  ]);

  expect(report.data.instances.map((i) => i.instanceId)).toEqual(["instance-1", "instance-2"]);
});

// Reading lazily is the point: an instance must not be touched before the caller asks
// for it, or the whole fleet is in memory again.
test("no instance is read until its entry is pulled from the stream", () => {
  const read: string[] = [];
  const service = new InstanceReportService({
    findInstanceIds: () => ["instance-1", "instance-2"],
    findByInstance: (instanceId: string) => {
      read.push(instanceId);
      return [row({ instanceId })];
    },
  } as unknown as InstanceReportRepository);

  const { entries } = service.reportStream();
  expect(read).toEqual([]);

  entries.next();
  expect(read).toEqual(["instance-1"]);

  entries.next();
  expect(read).toEqual(["instance-1", "instance-2"]);
});

test("the report groups points by name and tags each with its batchId and receivedAt, without folding", () => {
  const report = reportFrom([
    row({
      batchId: "b1",
      receivedAt: "2026-03-25T02:00:00.000Z",
      dataPoints: [
        { kind: "daily", name: "billableExecutionPerDay", value: 100, date: "2026-03-24" },
        { kind: "cumulative", name: "billableExecutionTotal", value: 900000 },
      ],
    }),
    row({
      batchId: "b2",
      receivedAt: "2026-03-26T02:00:00.000Z",
      dataPoints: [{ kind: "cumulative", name: "billableExecutionTotal", value: 900110 }],
    }),
  ]);

  expect(report.data.instances[0].dataPoints).toEqual({
    billableExecutionPerDay: [
      { kind: "daily", date: "2026-03-24", value: 100, batchId: "b1", receivedAt: "2026-03-25T02:00:00.000Z" },
    ],
    // Both cumulative readings survive — no "latest only".
    billableExecutionTotal: [
      { kind: "cumulative", value: 900000, batchId: "b1", receivedAt: "2026-03-25T02:00:00.000Z" },
      { kind: "cumulative", value: 900110, batchId: "b2", receivedAt: "2026-03-26T02:00:00.000Z" },
    ],
  });
});

test("the report stamps the generation time", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-03T14:30:00.000Z"));

  try {
    expect(reportFrom([])).toEqual({
      data: { generatedAt: "2026-09-03T14:30:00.000Z", instances: [] },
    });
  } finally {
    vi.useRealTimers();
  }
});
