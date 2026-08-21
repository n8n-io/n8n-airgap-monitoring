import * as assert from "node:assert";
import { test } from "vitest";
import type { InstanceReport, InstanceReportRepository, InstanceReportRow } from "./instance-report.repository";
import { type CreateInstanceReport, InstanceReportService } from "./instance-report.service";

const report: CreateInstanceReport = {
  instanceId: "instance-1",
  n8nVersion: "1.99.0",
  dataPoints: [
    { kind: "cumulative", name: "activeWorkflows", value: 7 },
    {
      kind: "daily",
      name: "prodExecutions",
      value: 42,
      batchId: "batch-1",
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

  assert.equal(inserted.length, 1);
  assert.ok(!Number.isNaN(Date.parse(inserted[0].receivedAt)));
});

test("ignores a received time supplied by the reporting instance", async () => {
  const { inserted, repository } = fakeRepository();
  const spoofed = "1999-01-01T00:00:00.000Z";

  new InstanceReportService(repository).recordReport({ ...report, receivedAt: spoofed } as InstanceReport);

  assert.notEqual(inserted[0].receivedAt, spoofed);
});

test("returns the id assigned by the repository", async () => {
  const { repository } = fakeRepository();
  const service = new InstanceReportService(repository);

  assert.deepEqual(service.recordReport(report), { id: 1 });
  assert.deepEqual(service.recordReport(report), { id: 2 });
});

/** A repository stub that only serves findByInstanceId, pre-seeded with rows. */
function fakeRepositoryWithRows(rows: InstanceReportRow[]) {
  const repository = {
    findByInstanceId(instanceId: string) {
      return rows.filter((row) => row.instanceId === instanceId);
    },
  };

  return repository as unknown as InstanceReportRepository;
}

function row(overrides: Partial<InstanceReportRow>): InstanceReportRow {
  return {
    instanceId: "instance-1",
    label: null,
    n8nVersion: "1.99.0",
    dataPoints: [],
    receivedAt: "2026-03-25T00:00:00.000Z",
    ...overrides,
  };
}

test("getMetricHistory returns null for an instance with no matching metric", () => {
  const repository = fakeRepositoryWithRows([row({ dataPoints: [{ kind: "cumulative", name: "other", value: 1 }] })]);

  assert.equal(new InstanceReportService(repository).getMetricHistory("instance-1", "activeWorkflows"), null);
});

test("getMetricHistory sorts daily points by date and dedupes retried batchIds", () => {
  const repository = fakeRepositoryWithRows([
    row({
      receivedAt: "2026-03-26T00:00:00.000Z",
      dataPoints: [{ kind: "daily", name: "prodExecutions", value: 5, batchId: "batch-2", date: "2026-03-26" }],
    }),
    row({
      receivedAt: "2026-03-25T00:00:00.000Z",
      dataPoints: [{ kind: "daily", name: "prodExecutions", value: 3, batchId: "batch-1", date: "2026-03-25" }],
    }),
    row({
      receivedAt: "2026-03-25T01:00:00.000Z",
      dataPoints: [{ kind: "daily", name: "prodExecutions", value: 4, batchId: "batch-1", date: "2026-03-25" }],
    }),
  ]);

  assert.deepEqual(new InstanceReportService(repository).getMetricHistory("instance-1", "prodExecutions"), {
    kind: "daily",
    points: [
      { date: "2026-03-25", value: 4, batchId: "batch-1" },
      { date: "2026-03-26", value: 5, batchId: "batch-2" },
    ],
  });
});

test("getMetricHistory returns cumulative points in receipt order", () => {
  const repository = fakeRepositoryWithRows([
    row({
      receivedAt: "2026-03-25T00:00:00.000Z",
      dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 10 }],
    }),
    row({
      receivedAt: "2026-03-26T00:00:00.000Z",
      dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 4 }],
    }),
  ]);

  assert.deepEqual(new InstanceReportService(repository).getMetricHistory("instance-1", "activeWorkflows"), {
    kind: "cumulative",
    points: [
      { receivedAt: "2026-03-25T00:00:00.000Z", value: 10 },
      { receivedAt: "2026-03-26T00:00:00.000Z", value: 4 },
    ],
  });
});

test("getMetricHistory drops points of the losing kind if a metric ever switched kind", () => {
  const repository = fakeRepositoryWithRows([
    row({
      receivedAt: "2026-03-25T00:00:00.000Z",
      dataPoints: [{ kind: "cumulative", name: "flexible", value: 10 }],
    }),
    row({
      receivedAt: "2026-03-26T00:00:00.000Z",
      dataPoints: [{ kind: "daily", name: "flexible", value: 4, batchId: "batch-1", date: "2026-03-26" }],
    }),
  ]);

  assert.deepEqual(new InstanceReportService(repository).getMetricHistory("instance-1", "flexible"), {
    kind: "daily",
    points: [{ date: "2026-03-26", value: 4, batchId: "batch-1" }],
  });
});
