import { afterEach, expect, test, vi } from "vitest";
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

// The plugin reads both variables when it registers, so each test stubs them
// before build(). unstubAllEnvs restores whatever was set before the stub,
// so the file does not depend on when build-app.ts assigns the cert.
afterEach(() => {
  vi.unstubAllEnvs();
});

test("trusts the test CA under NODE_ENV=test", async () => {
  const app = await build();

  const res = await app.inject({ method: "POST", url: URL, payload: report });
  expect(res.statusCode).toBe(201);
});

// The production image bakes NODE_ENV=production. Setting the variable on a
// deployed container must change nothing.
test("ignores TEST_LICENSE_ISSUER_CERT outside NODE_ENV=test", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const app = await build();

  const res = await app.inject({ method: "POST", url: URL, payload: report });
  expect(res.statusCode).toBe(401);
});

// A test run that lost the variable must not quietly fall back to accepting
// only real certificates while mock ones fail: the fixture is the mock CA.
test("uses the embedded n8n CA when TEST_LICENSE_ISSUER_CERT is unset", async () => {
  vi.stubEnv("TEST_LICENSE_ISSUER_CERT", undefined);
  const app = await build();

  const res = await app.inject({ method: "POST", url: URL, payload: report });
  expect(res.statusCode).toBe(401);
});

// Certificate mode is the default, and in it a bearer header is not a
// credential at all: it is neither checked nor a substitute for the
// certificate.
test("ignores bearer headers in certificate mode", async () => {
  const app = await build();
  expect(app.config.writeToken).toBeUndefined();

  const { licenseCert: _omitted, ...bare } = report;
  const headers = { authorization: "Bearer anything" };

  const withoutCert = await app.inject({ method: "POST", url: URL, headers, payload: bare });
  expect(withoutCert.statusCode).toBe(401);
  expect(withoutCert.json()).toMatchObject({ message: "Missing license certificate" });

  const withCert = await app.inject({ method: "POST", url: URL, headers, payload: report });
  expect(withCert.statusCode).toBe(201);
});

// A blank value is the same as unset, so a templated `WRITE_TOKEN=` line in a
// deployment leaves the service in certificate mode rather than turning the
// empty string into a credential.
test("treats a blank write token as unset and stays in certificate mode", async () => {
  vi.stubEnv("N8N_MONITORING_WRITE_TOKEN", "   ");
  const app = await build();
  expect(app.config.writeToken).toBeUndefined();

  const res = await app.inject({
    method: "POST",
    url: URL,
    headers: { authorization: "Bearer " },
    payload: { instanceId: "x" },
  });
  expect(res.statusCode).toBe(401);
  expect(res.json()).toMatchObject({ message: "Missing license certificate" });
});
