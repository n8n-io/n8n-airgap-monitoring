import { afterEach, expect, test } from "vitest";
import { build } from "../testing/build-app";
import { generateMockLicense } from "../testing/mock-license";

const URL = "/api/v1/instance-reports";

const report = {
  instanceId: "instance-1",
  batchId: "batch-1",
  n8nVersion: "1.99.0",
  dataPoints: [{ kind: "cumulative", name: "activeWorkflows", value: 1 }],
  licenseCert: generateMockLicense(),
};

// The plugin reads both variables when it registers, so each test sets them
// before build() and puts them back afterwards for the rest of the run.
const saved = { nodeEnv: process.env.NODE_ENV, testCert: process.env.TEST_LICENSE_ISSUER_CERT };

afterEach(() => {
  process.env.NODE_ENV = saved.nodeEnv;
  process.env.TEST_LICENSE_ISSUER_CERT = saved.testCert;
});

test("trusts the test CA under NODE_ENV=test", async () => {
  const app = await build();

  const res = await app.inject({ method: "POST", url: URL, payload: report });
  expect(res.statusCode).toBe(201);
});

// The production image bakes NODE_ENV=production. Setting the variable on a
// deployed container must change nothing.
test("ignores TEST_LICENSE_ISSUER_CERT outside NODE_ENV=test", async () => {
  process.env.NODE_ENV = "production";
  const app = await build();

  const res = await app.inject({ method: "POST", url: URL, payload: report });
  expect(res.statusCode).toBe(401);
});

// A test run that lost the variable must not quietly fall back to accepting
// only real certificates while mock ones fail: the fixture is the mock CA.
test("uses the embedded n8n CA when TEST_LICENSE_ISSUER_CERT is unset", async () => {
  delete process.env.TEST_LICENSE_ISSUER_CERT;
  const app = await build();

  const res = await app.inject({ method: "POST", url: URL, payload: report });
  expect(res.statusCode).toBe(401);
});
