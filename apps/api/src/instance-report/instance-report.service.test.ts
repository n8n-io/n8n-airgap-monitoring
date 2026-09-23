import { expect, test } from "vitest";
import type { InstanceReport, InstanceReportRepository, InstanceReportRow } from "./instance-report.repository";
import { type CreateInstanceReport, type InstanceReportEntry, InstanceReportService } from "./instance-report.service";

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
    findInstanceIds: async () => instanceIds,
    findByInstanceId: async (instanceId: string) => rows.filter((r) => r.instanceId === instanceId),
  } as unknown as InstanceReportRepository);
}

/** Drains the streaming report into an array, the way the route does as it writes each chunk. */
async function collectInstances(service: InstanceReportService): Promise<InstanceReportEntry[]> {
  const instances: InstanceReportEntry[] = [];
  for await (const entry of service.streamInstanceReports()) {
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
    dataPoints: [],
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
