import { expect, test } from "vitest";
import { build } from "../testing/build-app";
import { generateMockLicense } from "../testing/mock-license";

// The compose file, the k8s demo and the backfill script all run in token
// mode, so outside this suite nothing exercises certificate mode against a
// listening server. This test does: a real socket, a real HTTP body of
// realistic size, no inject() shortcut, from request to stored row.
test("a license certificate authenticates a report over real HTTP", async () => {
  const app = await build();
  // Certificate mode: the harness sets no write token.
  expect(app.config.writeToken).toBeUndefined();
  const baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });

  const report = {
    instanceId: "e2e-instance",
    batchId: "e2e-batch-1",
    n8nVersion: "1.99.0",
    dataPoints: [{ kind: "daily", name: "billableExecutionPerDay", value: 12, date: "2026-03-25" }],
    licenseCert: generateMockLicense(),
  };

  const res = await fetch(`${baseUrl}/api/v1/instance-reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  });
  expect(res.status).toBe(201);

  const { id } = (await res.json()) as { id: number };
  const [row] = (await app.dataSource.query("SELECT instanceId, batchId, data FROM instance_reports WHERE id = ?", [
    id,
  ])) as Record<string, string>[];
  expect(row.instanceId).toBe("e2e-instance");
  expect(row.batchId).toBe("e2e-batch-1");
  expect(JSON.parse(row.data)).toEqual(report.dataPoints);
  expect(JSON.stringify(row)).not.toContain(report.licenseCert);

  // Same report without any credential, to show the certificate did the work.
  const { licenseCert: _omitted, ...bare } = report;
  const unauthenticated = await fetch(`${baseUrl}/api/v1/instance-reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...bare, batchId: "e2e-batch-2" }),
  });
  expect(unauthenticated.status).toBe(401);
});
