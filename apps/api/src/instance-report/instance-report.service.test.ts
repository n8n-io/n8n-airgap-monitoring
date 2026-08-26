import * as assert from "node:assert";
import { test } from "vitest";
import type { InstanceReport, InstanceReportRepository } from "./instance-report.repository";
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

  new InstanceReportService(repository).recordReport(report);

  assert.equal(inserted.length, 1);
  assert.ok(!Number.isNaN(Date.parse(inserted[0].receivedAt)));
});

test("passes the reporting instance's batchId through untouched", async () => {
  const { inserted, repository } = fakeRepository();

  new InstanceReportService(repository).recordReport(report);

  assert.equal(inserted[0].batchId, "batch-1");
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
