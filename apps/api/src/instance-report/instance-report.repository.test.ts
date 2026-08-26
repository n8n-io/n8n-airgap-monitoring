import * as assert from "node:assert";
import { test } from "vitest";
import { build } from "../testing/build-app";
import { DuplicateBatchError, type InstanceReport, InstanceReportRepository } from "./instance-report.repository";

const event: InstanceReport = {
  instanceId: "instance-1",
  batchId: "batch-1",
  n8nVersion: "1.99.0",
  dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 7 }],
  receivedAt: "2026-03-25T00:00:00.000Z",
};

// Built against the real database, because the point of the assertion is that
// the driver's constraint error is translated rather than escaping as-is.
test("translates a repeated batchId into a DuplicateBatchError", async () => {
  const app = await build();
  const repository = new InstanceReportRepository(app.db);

  repository.insert(event);

  assert.throws(() => repository.insert(event), DuplicateBatchError);
});
