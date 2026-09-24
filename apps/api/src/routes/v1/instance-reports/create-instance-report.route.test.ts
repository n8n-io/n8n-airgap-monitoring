import { afterEach, describe, expect, test, vi } from "vitest";
import { build } from "../../../test-utils/build-app";
import {
  generateMockLicense,
  generateMockLicenseWithForgedIssuer,
  generateMockLicenseWithTamperedPayload,
} from "../../../test-utils/mock-license";
import {
  instanceReportSchema,
  LICENSE_CERT_BUDGET_BYTES,
  REPORT_BODY_LIMIT_BYTES,
} from "./create-instance-report.route";

const URL = "/api/v1/instance-reports";

// One certificate for the whole file: minting costs an RSA operation, and the
// receiver does not care that every report carries the same one.
const licenseCert = generateMockLicense();

const validReport = {
  instanceId: "instance-1",
  batchId: "batch-1",
  n8nVersion: "1.99.0",
  dataPoints: [
    { kind: "cumulative", name: "activeWorkflows", value: 87 },
    { kind: "cumulative", name: "successRate", value: 99.5 },
    {
      kind: "daily",
      name: "prodExecutions",
      value: 15234,
      date: "2026-03-25",
    },
  ],
};

/** The wire payload: the report plus the credential that authenticates it. */
const authorized = (report: object = validReport) => ({ ...report, licenseCert });

test("stores an accepted instance report", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    payload: authorized(),
  });

  expect(res.statusCode).toBe(201);

  const { id } = res.json() as { id: number };
  // Read the raw row, so the assertion sees what was stored, not what the ORM maps.
  const [row] = (await app.dataSource.query("SELECT * FROM instance_reports WHERE id = ?", [id])) as Record<
    string,
    string
  >[];

  expect(row.instanceId).toBe("instance-1");
  expect(row.batchId).toBe("batch-1");
  expect(row.label).toBe(null);
  expect(row.n8nVersion).toBe("1.99.0");
  expect(JSON.parse(row.data)).toEqual(validReport.dataPoints);
  expect(Number.isNaN(Date.parse(row.receivedAt))).toBe(false);
});

// The certificate is the customer's license. It is a credential, not data,
// and must not survive the request in any form.
test("never stores the license certificate", async () => {
  const app = await build();

  const res = await app.inject({ method: "POST", url: URL, payload: authorized() });
  expect(res.statusCode).toBe(201);

  const [row] = (await app.dataSource.query("SELECT * FROM instance_reports")) as Record<string, unknown>[];
  expect(JSON.stringify(row)).not.toContain(licenseCert);
  expect(Object.keys(row)).not.toContain("licenseCert");

  const report = await app.inject({
    method: "GET",
    url: "/api/v1/report",
    headers: { authorization: "Bearer test-read-token" },
  });
  expect(report.statusCode).toBe(200);
  expect(report.body).not.toContain(licenseCert);
  expect(report.body).not.toContain("licenseCert");
});

test("stores the optional label when provided", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    payload: authorized({ ...validReport, label: "Kiwi prod" }),
  });

  expect(res.statusCode).toBe(201);

  const { id } = res.json() as { id: number };
  const [row] = (await app.dataSource.query("SELECT label FROM instance_reports WHERE id = ?", [id])) as {
    label: string;
  }[];

  expect(row.label).toBe("Kiwi prod");
});

test("appends every report instead of overwriting the instance", async () => {
  const app = await build();

  for (const value of [10, 25]) {
    const res = await app.inject({
      method: "POST",
      url: URL,
      payload: authorized({
        ...validReport,
        batchId: `batch-${value}`,
        dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value }],
      }),
    });
    expect(res.statusCode).toBe(201);
  }

  const stored = (await app.dataSource.query("SELECT data FROM instance_reports WHERE instanceId = ? ORDER BY id", [
    "instance-1",
  ])) as { data: string }[];

  expect(stored.map((row) => JSON.parse(row.data)[0].value)).toEqual([10, 25]);
});

// The uniqueness guard is scoped per instance: two instances picking the same
// batchId are unrelated envelopes, and rejecting either would lose a report.
test("keeps envelopes that share a batchId across different instances", async () => {
  const app = await build();

  for (const instanceId of ["instance-1", "instance-2"]) {
    const res = await app.inject({
      method: "POST",
      url: URL,
      payload: authorized({ ...validReport, instanceId }),
    });
    expect(res.statusCode).toBe(201);
  }

  expect(await app.dataSource.query("SELECT COUNT(*) AS count FROM instance_reports")).toEqual([{ count: 2 }]);
});

test("rejects a repeated batchId as a conflict", async () => {
  const app = await build();

  const post = () => app.inject({ method: "POST", url: URL, payload: authorized() });

  expect((await post()).statusCode).toBe(201);

  const res = await post();

  expect(res.statusCode).toBe(409);

  const { message } = res.json() as { message: string };

  expect(message).toContain("batch-1");
  // The client is told what it did, not how the store is built.
  expect(/SQLITE|UNIQUE/i.test(message)).toBe(false);

  expect(
    await app.dataSource.query("SELECT COUNT(*) AS count FROM instance_reports WHERE instanceId = ? AND batchId = ?", [
      "instance-1",
      "batch-1",
    ]),
  ).toEqual([{ count: 1 }]);
});

// Expiry is deliberately not checked: an instance whose license ran out is
// still a licensed instance, and its usage is still wanted.
test("accepts an expired license certificate", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    payload: { ...validReport, licenseCert: generateMockLicense({ expired: true }) },
  });

  expect(res.statusCode).toBe(201);
});

test("rejects a request without a license certificate", async () => {
  const app = await build();

  const res = await app.inject({ method: "POST", url: URL, payload: validReport });

  expect(res.statusCode).toBe(401);
  // Same error envelope as every other error the route produces.
  expect(res.json()).toMatchObject({ statusCode: 401, error: "Unauthorized", message: expect.any(String) });
  expect(await app.dataSource.query("SELECT COUNT(*) AS count FROM instance_reports")).toEqual([{ count: 0 }]);
});

test("rejects license certificates that do not verify", async () => {
  const app = await build();

  const rejected: Record<string, unknown> = {
    "empty string": "",
    "not a string": 42,
    "not base64 JSON": "definitely-not-a-license-certificate-at-all-just-text",
    "wrong issuer": generateMockLicenseWithForgedIssuer(),
    "tampered payload": generateMockLicenseWithTamperedPayload(),
  };

  for (const [description, cert] of Object.entries(rejected)) {
    const res = await app.inject({ method: "POST", url: URL, payload: { ...validReport, licenseCert: cert } });

    expect(res.statusCode, `expected 401 for ${description}`).toBe(401);
    // Nothing about the certificate reaches the client.
    if (typeof cert === "string" && cert.length >= 20) {
      expect(res.body, `response for ${description} leaks the certificate`).not.toContain(cert.slice(0, 20));
    }
  }

  expect(await app.dataSource.query("SELECT COUNT(*) AS count FROM instance_reports")).toEqual([{ count: 0 }]);
});

// Authentication runs before validation, so an unauthenticated caller cannot
// probe the schema.
test("rejects a bad certificate before looking at the report", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    payload: { instanceId: "", licenseCert: "not-a-certificate-and-not-even-close-to-long-enough-x" },
  });

  expect(res.statusCode).toBe(401);
});

test("rejects malformed instance reports", async () => {
  const app = await build();

  const invalidPayloads: Record<string, unknown> = {
    "missing instanceId": { batchId: "batch-1", n8nVersion: "1.99.0", dataPoints: validReport.dataPoints },
    "empty instanceId": { ...validReport, instanceId: "" },
    "missing batchId": { instanceId: "instance-1", n8nVersion: "1.99.0", dataPoints: validReport.dataPoints },
    "empty batchId": { ...validReport, batchId: "" },
    "missing n8nVersion": { instanceId: "instance-1", batchId: "batch-1", dataPoints: validReport.dataPoints },
    "missing dataPoints": { instanceId: "instance-1", batchId: "batch-1", n8nVersion: "1.99.0" },
    "empty dataPoints": { ...validReport, dataPoints: [] },
    "string metric value": { ...validReport, dataPoints: [{ kind: "cumulative", name: "x", value: "15234" }] },
    "null metric value": { ...validReport, dataPoints: [{ kind: "cumulative", name: "x", value: null }] },
    "boolean metric value": { ...validReport, dataPoints: [{ kind: "cumulative", name: "x", value: true }] },
    "metric missing kind": { ...validReport, dataPoints: [{ name: "x", value: 1 }] },
    "metric with unknown kind": { ...validReport, dataPoints: [{ kind: "unknown", name: "x", value: 1 }] },
    "daily metric missing date": {
      ...validReport,
      dataPoints: [{ kind: "daily", name: "x", value: 1 }],
    },
    "non-calendar date": {
      ...validReport,
      dataPoints: [{ kind: "daily", name: "x", value: 1, date: "2026-02-30" }],
    },
    "timestamp instead of date": {
      ...validReport,
      dataPoints: [{ kind: "daily", name: "x", value: 1, date: "2026-03-25T00:00:00.000Z" }],
    },
    "empty label": { ...validReport, label: "" },
    "non-string label": { ...validReport, label: 42 },
    "oversized label": { ...validReport, label: "x".repeat(201) },
    "oversized instanceId": { ...validReport, instanceId: "x".repeat(257) },
    "oversized batchId": { ...validReport, batchId: "x".repeat(129) },
    "oversized n8nVersion": { ...validReport, n8nVersion: "x".repeat(65) },
    "more than 1000 data points": {
      ...validReport,
      dataPoints: Array.from({ length: 1001 }, () => ({ kind: "cumulative", name: "x", value: 1 })),
    },
    "oversized metric name": { ...validReport, dataPoints: [{ kind: "cumulative", name: "x".repeat(101), value: 1 }] },
    // The pattern keeps a name at one byte per character, which the body limit relies on.
    "metric name with a space": { ...validReport, dataPoints: [{ kind: "cumulative", name: "a b", value: 1 }] },
    "metric name with a non-ASCII character": {
      ...validReport,
      dataPoints: [{ kind: "cumulative", name: "ausführungen", value: 1 }],
    },
  };

  for (const [description, payload] of Object.entries(invalidPayloads)) {
    const res = await app.inject({
      method: "POST",
      url: URL,
      payload: authorized(payload as object),
    });

    expect(res.statusCode, `expected 400 for ${description}`).toBe(400);
  }

  expect(await app.dataSource.query("SELECT COUNT(*) AS count FROM instance_reports")).toEqual([{ count: 0 }]);
});

// Fastify checks the size while it reads the body, so an oversized body is
// never parsed and gets 413 before it can get 401 or 400.
test("rejects a body over the size limit before authentication and validation", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    payload: { instanceId: "x".repeat(REPORT_BODY_LIMIT_BYTES) },
  });

  expect(res.statusCode).toBe(413);
  expect(res.json()).toMatchObject({ statusCode: 413, error: "Payload Too Large", message: expect.any(String) });
  expect(await app.dataSource.query("SELECT COUNT(*) AS count FROM instance_reports")).toEqual([{ count: 0 }]);
});

// Token mode: the operator set a write token, so it is the only credential and
// certificates are not looked at. build-app.ts defaults to certificate mode,
// hence the stub before every build() here.
describe("in token mode", () => {
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function buildInTokenMode() {
    vi.stubEnv("N8N_MONITORING_WRITE_TOKEN", "test-write-token");
    return await build();
  }

  test("accepts the write token as a bearer header", async () => {
    const app = await buildInTokenMode();

    const res = await app.inject({
      method: "POST",
      url: URL,
      headers: bearer("test-write-token"),
      payload: validReport,
    });

    expect(res.statusCode).toBe(201);
  });

  test("rejects a wrong write token without leaking the right one", async () => {
    const app = await buildInTokenMode();

    const res = await app.inject({ method: "POST", url: URL, headers: bearer("wrong"), payload: validReport });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ message: "Invalid write token" });
    expect(res.body).not.toContain("test-write-token");
    expect(await app.dataSource.query("SELECT COUNT(*) AS count FROM instance_reports")).toEqual([{ count: 0 }]);
  });

  // The point of the mode: a licensee's certificate alone opens nothing, so the
  // endpoint is safe without network rules that restrict it to the operator's
  // own instances.
  test("rejects a valid license certificate, since only the token is a credential", async () => {
    const app = await buildInTokenMode();

    const res = await app.inject({ method: "POST", url: URL, payload: authorized() });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ message: "Missing write token" });
    expect(await app.dataSource.query("SELECT COUNT(*) AS count FROM instance_reports")).toEqual([{ count: 0 }]);
  });

  test("never stores a certificate that rides along with a token-authenticated report", async () => {
    const app = await buildInTokenMode();

    const res = await app.inject({
      method: "POST",
      url: URL,
      headers: bearer("test-write-token"),
      payload: authorized(),
    });
    expect(res.statusCode).toBe(201);

    const [row] = (await app.dataSource.query("SELECT * FROM instance_reports")) as Record<string, unknown>[];
    expect(JSON.stringify(row)).not.toContain(licenseCert);
    expect(Object.keys(row)).not.toContain("licenseCert");
  });

  test("accepts 30 metrics with 30 daily and 1 cumulative point each and a certificate at its budget", async () => {
    const app = await buildInTokenMode();

    const days = Array.from({ length: 30 }, (_, day) => `2026-03-${String(day + 1).padStart(2, "0")}`);
    const dataPoints = Array.from({ length: 30 }, (_, index) => `metric${index}`.padEnd(100, "x")).flatMap((name) => [
      { kind: "cumulative", name, value: 123456789 },
      ...days.map((date) => ({ kind: "daily", name, value: 123456789, date })),
    ]);

    const res = await app.inject({
      method: "POST",
      url: URL,
      headers: bearer("test-write-token"),
      payload: { ...validReport, dataPoints, licenseCert: "x".repeat(LICENSE_CERT_BUDGET_BYTES) },
    });

    expect(res.statusCode).toBe(201);
  });

  // The rule behind REPORT_BODY_LIMIT_BYTES: a report at every schema limit at
  // once still fits together with a certificate at its budget. The limits come
  // from the schema, so a larger schema limit without a larger body limit fails here.
  test("accepts a report at every schema limit together with a certificate at its budget", async () => {
    const app = await buildInTokenMode();

    const { properties } = instanceReportSchema;
    // JSON.stringify writes a control character as a 6-byte escape, the most any character takes.
    const widest = (length: number) => "\u0001".repeat(length);
    const report = {
      instanceId: widest(properties.instanceId.maxLength),
      batchId: widest(properties.batchId.maxLength),
      label: widest(properties.label.maxLength),
      n8nVersion: widest(properties.n8nVersion.maxLength),
      // A daily point is the longer kind, and -Number.MAX_VALUE is the longest number JSON.stringify writes.
      dataPoints: Array.from({ length: properties.dataPoints.maxItems }, () => ({
        kind: "daily",
        name: "x".repeat(properties.dataPoints.items.properties.name.maxLength),
        value: -Number.MAX_VALUE,
        date: "2026-03-25",
      })),
      licenseCert: "x".repeat(LICENSE_CERT_BUDGET_BYTES),
    };

    const res = await app.inject({ method: "POST", url: URL, headers: bearer("test-write-token"), payload: report });

    expect(res.statusCode).toBe(201);
  });
});

test("ignores unknown top level fields so newer instances stay compatible", async () => {
  const app = await build();

  const res = await app.inject({
    method: "POST",
    url: URL,
    payload: authorized({ ...validReport, someFutureField: "ignored" }),
  });

  expect(res.statusCode).toBe(201);
});
