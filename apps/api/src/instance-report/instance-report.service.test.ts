import { expect, test } from "vitest";
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
