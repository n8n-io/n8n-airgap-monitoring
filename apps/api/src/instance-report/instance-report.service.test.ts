import { expect, test, vi } from "vitest";
import type { InstanceReport, InstanceReportRepository, InstanceReportRow } from "./instance-report.repository";
import { type CreateInstanceReport, InstanceReportService } from "./instance-report.service";

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

  await new InstanceReportService(repository).recordReport(report);

  expect(inserted.length).toBe(1);
  expect(Number.isNaN(Date.parse(inserted[0].receivedAt))).toBe(false);
});

test("passes the reporting instance's batchId through untouched", async () => {
  const { inserted, repository } = fakeRepository();

  await new InstanceReportService(repository).recordReport(report);

  expect(inserted[0].batchId).toBe("batch-1");
});

test("returns the id assigned by the repository", async () => {
  const { repository } = fakeRepository();
  const service = new InstanceReportService(repository);

  expect(await service.recordReport(report)).toEqual({ id: 1 });
  expect(await service.recordReport(report)).toEqual({ id: 2 });
});

/** A repository stub whose findAll returns pre-built rows in the order given. */
function fakeReportRepository(rows: InstanceReportRow[]): InstanceReportService {
  return new InstanceReportService({ findAll: () => rows } as unknown as InstanceReportRepository);
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

test("generateReport takes firstSeen from the earliest row, and label and lastReportAt from the latest", async () => {
  const report = await fakeReportRepository([
    row({ batchId: "b1", label: "first", receivedAt: "2026-03-20T02:00:00.000Z" }),
    row({ batchId: "b2", label: "latest", receivedAt: "2026-03-25T02:00:00.000Z" }),
  ]).generateReport();

  expect(report.data.instances[0].firstSeen).toBe("2026-03-20T02:00:00.000Z");
  expect(report.data.instances[0].label).toBe("latest");
  expect(report.data.instances[0].lastReportAt).toBe("2026-03-25T02:00:00.000Z");
});

test("generateReport files a metric named __proto__ as data instead of crashing", async () => {
  const protoKey = "__proto__";
  const report = await fakeReportRepository([
    row({ dataPoints: [{ kind: "cumulative", name: protoKey, value: 5 }] }),
  ]).generateReport();

  expect(report.data.instances[0].dataPoints[protoKey]).toEqual([
    { kind: "cumulative", value: 5, batchId: "batch-1", receivedAt: "2026-03-25T02:00:00.000Z" },
  ]);
});

test("generateReport groups points by name and tags each with its batchId and receivedAt, without folding", async () => {
  const report = await fakeReportRepository([
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
  ]).generateReport();

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

test("generateReport stamps the generation time", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-03T14:30:00.000Z"));

  try {
    expect(await fakeReportRepository([]).generateReport()).toEqual({
      data: { generatedAt: "2026-09-03T14:30:00.000Z", instances: [] },
    });
  } finally {
    vi.useRealTimers();
  }
});
