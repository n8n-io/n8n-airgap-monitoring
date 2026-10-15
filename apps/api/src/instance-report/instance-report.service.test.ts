import { describe, expect, test } from "vitest";
import type { InstanceReport, InstanceReportRepository, InstanceReportRow } from "./instance-report.repository";
import {
  type CreateInstanceReport,
  type InstanceReportEntry,
  InstanceReportService,
  type ReportFilter,
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

/**
 * A repository stub whose per-instance reads serve pre-built rows. The streaming
 * report groups by instanceId, so the fake derives the id list from the rows
 * (order preserved) and filters per instance — mirroring the real repository.
 */
function fakeReportService(rows: InstanceReportRow[]): InstanceReportService {
  const instanceIds = [...new Set(rows.map((r) => r.instanceId))];
  return new InstanceReportService({
    findInstanceIds: async (only?: string[]) => instanceIds.filter((id) => only === undefined || only.includes(id)),
    findByInstanceId: async (instanceId: string) => rows.filter((r) => r.instanceId === instanceId),
  } as unknown as InstanceReportRepository);
}

/** Drains the streaming report into an array, the way the route does as it writes each chunk. */
async function collectInstances(service: InstanceReportService, filter?: ReportFilter): Promise<InstanceReportEntry[]> {
  const instances: InstanceReportEntry[] = [];
  for await (const entry of service.streamInstanceReports(filter)) {
    instances.push(entry);
  }
  return instances;
}

function row(overrides: Partial<InstanceReportRow>): InstanceReportRow {
  return {
    instanceId: "instance-1",
    batchId: "batch-1",
    label: null,
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 1 }],
    receivedAt: "2026-03-25T02:00:00.000Z",
    ...overrides,
  };
}

test("streamInstanceReports takes firstSeen from the earliest row, and label and lastReportAt from the latest", async () => {
  const [instance] = await collectInstances(
    fakeReportService([
      row({ batchId: "b1", label: "first", receivedAt: "2026-03-20T02:00:00.000Z" }),
      row({ batchId: "b2", label: "latest", receivedAt: "2026-03-25T02:00:00.000Z" }),
    ]),
  );

  expect(instance.firstSeen).toBe("2026-03-20T02:00:00.000Z");
  expect(instance.label).toBe("latest");
  expect(instance.lastReportAt).toBe("2026-03-25T02:00:00.000Z");
});

test("streamInstanceReports files a metric named __proto__ as data instead of crashing", async () => {
  const protoKey = "__proto__";
  const [instance] = await collectInstances(
    fakeReportService([row({ dataPoints: [{ kind: "cumulative", name: protoKey, value: 5 }] })]),
  );

  expect(instance.dataPoints[protoKey]).toEqual([
    { kind: "cumulative", value: 5, batchId: "batch-1", receivedAt: "2026-03-25T02:00:00.000Z" },
  ]);
});

test("streamInstanceReports groups points by name and tags each with its batchId and receivedAt, without folding", async () => {
  const [instance] = await collectInstances(
    fakeReportService([
      row({
        batchId: "b1",
        receivedAt: "2026-03-25T02:00:00.000Z",
        dataPoints: [
          { kind: "daily", name: "billableExecutions", value: 100, date: "2026-03-24" },
          { kind: "cumulative", name: "billableExecutions", value: 900000 },
        ],
      }),
      row({
        batchId: "b2",
        receivedAt: "2026-03-26T02:00:00.000Z",
        dataPoints: [{ kind: "cumulative", name: "billableExecutions", value: 900110 }],
      }),
    ]),
  );

  expect(instance.dataPoints).toEqual({
    billableExecutions: [
      { kind: "daily", date: "2026-03-24", value: 100, batchId: "b1", receivedAt: "2026-03-25T02:00:00.000Z" },
      { kind: "cumulative", value: 900000, batchId: "b1", receivedAt: "2026-03-25T02:00:00.000Z" },
      { kind: "cumulative", value: 900110, batchId: "b2", receivedAt: "2026-03-26T02:00:00.000Z" },
    ],
  });
});

test("streamInstanceReports yields one entry per instance and nothing for an empty store", async () => {
  expect(await collectInstances(fakeReportService([]))).toEqual([]);

  const instances = await collectInstances(
    fakeReportService([
      row({ instanceId: "instance-1", batchId: "a" }),
      row({ instanceId: "instance-2", batchId: "b" }),
    ]),
  );

  expect(instances.map((i) => i.instanceId)).toEqual(["instance-1", "instance-2"]);
});

test("streamInstanceReports yields only the instances the filter asks for", async () => {
  const service = fakeReportService([
    row({ instanceId: "instance-1", batchId: "a" }),
    row({ instanceId: "instance-2", batchId: "b" }),
    row({ instanceId: "instance-3", batchId: "c" }),
  ]);

  const instances: InstanceReportEntry[] = [];
  for await (const entry of service.streamInstanceReports({ instanceIds: ["instance-1", "instance-3"] })) {
    instances.push(entry);
  }

  expect(instances.map((i) => i.instanceId)).toEqual(["instance-1", "instance-3"]);
});

describe("streamInstanceReports filtered by start and end", () => {
  const daily = (date: string) => ({ kind: "daily" as const, name: "billableExecutions", value: 1, date });

  const cumulative = (batchId: string, receivedAt: string) =>
    row({ batchId, receivedAt, dataPoints: [{ kind: "cumulative", name: "billableExecutions", value: 1 }] });

  test("when a cumulative value is received on the start or end day, then it is kept, and a millisecond outside is left out", async () => {
    const service = fakeReportService([
      cumulative("before-start", "2026-09-30T23:59:59.999Z"),
      cumulative("on-start", "2026-10-01T00:00:00.000Z"),
      cumulative("on-end", "2026-10-31T23:59:59.999Z"),
      cumulative("after-end", "2026-11-01T00:00:00.000Z"),
    ]);

    const [instance] = await collectInstances(service, { start: "2026-10-01", end: "2026-10-31" });

    expect(instance.dataPoints.billableExecutions.map((point) => point.batchId)).toEqual(["on-start", "on-end"]);
  });

  test("when an instance has no values in the range, then it is left out of the report", async () => {
    const service = fakeReportService([
      row({ instanceId: "in-range", dataPoints: [daily("2026-10-15")] }),
      row({ instanceId: "out-of-range", dataPoints: [daily("2026-11-15")] }),
    ]);

    const instances = await collectInstances(service, { start: "2026-10-01", end: "2026-10-31" });

    expect(instances.map((i) => i.instanceId)).toEqual(["in-range"]);
  });

  test("when the range excludes some rows, then firstSeen, lastReportAt and label still come from the full history", async () => {
    const service = fakeReportService([
      row({ batchId: "b1", label: "first", receivedAt: "2026-09-01T02:00:00.000Z", dataPoints: [daily("2026-08-31")] }),
      row({
        batchId: "b2",
        label: "middle",
        receivedAt: "2026-10-16T02:00:00.000Z",
        dataPoints: [daily("2026-10-15")],
      }),
      row({
        batchId: "b3",
        label: "latest",
        receivedAt: "2026-12-01T02:00:00.000Z",
        dataPoints: [daily("2026-11-30")],
      }),
    ]);

    const [instance] = await collectInstances(service, { start: "2026-10-01", end: "2026-10-31" });

    expect(instance).toMatchObject({
      firstSeen: "2026-09-01T02:00:00.000Z",
      lastReportAt: "2026-12-01T02:00:00.000Z",
      label: "latest",
    });
  });
});
