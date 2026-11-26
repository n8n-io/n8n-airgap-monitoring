import { afterEach, expect, test, vi } from "vitest";
import { PLACEHOLDER_REPORT_UPLOAD_FORM_URL } from "../../../plugins/config";
import { build } from "../../../test-utils/build-app";

const URL = "/api/v1/submissions";
const READ = { authorization: "Bearer test-read-token" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test.each([
  ["GET", URL],
  ["POST", `${URL}/2026-09`],
] as const)("%s %s rejects a request without a bearer token", async (method, url) => {
  const app = await build();

  const res = await app.inject({ method, url });

  expect(res.statusCode).toBe(401);
});

test.each([
  ["a wrong token", "Bearer nope"],
  ["the write token", "Bearer test-write-token"],
])("rejects %s", async (_name, authorization) => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: URL, headers: { authorization } });

  expect(res.statusCode).toBe(401);
});

test("serves the overview with the read token", async () => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: URL, headers: READ });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({
    pending: [],
    upcoming: [],
    submitted: [],
    destination: null,
    uploadFormUrl: PLACEHOLDER_REPORT_UPLOAD_FORM_URL,
  });
});

test("hands the report destination and its auth token to the page", async () => {
  vi.stubEnv("N8N_MONITORING_REPORT_DESTINATION", "https://n8n.example.com/webhook/usage");
  vi.stubEnv("N8N_MONITORING_REPORT_DESTINATION_AUTH_TOKEN", "destination-secret");
  const app = await build();

  const res = await app.inject({ method: "GET", url: URL, headers: READ });

  expect(res.json().destination).toEqual({
    url: "https://n8n.example.com/webhook/usage",
    authToken: "destination-secret",
  });
  expect(res.headers["cache-control"]).toBe("no-store");
});

test("hands the upload form URL to the page", async () => {
  vi.stubEnv("N8N_MONITORING_REPORT_UPLOAD_FORM_URL", "https://n8n.example.com/form/usage");
  const app = await build();

  const res = await app.inject({ method: "GET", url: URL, headers: READ });

  expect(res.json().uploadFormUrl).toBe("https://n8n.example.com/form/usage");
});

test("records a pending month with the read token", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T00:00:00.000Z"));
  const app = await build();

  const res = await app.inject({ method: "POST", url: `${URL}/2026-09`, headers: READ });

  expect(res.statusCode).toBe(201);
  const overview = await app.inject({ method: "GET", url: URL, headers: READ });
  expect(overview.json().submitted).toEqual([{ month: "2026-09", submittedAt: "2026-10-05T00:00:00.000Z" }]);
});

test("refuses a month that is not pending yet", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T00:00:00.000Z"));
  const app = await build();

  const res = await app.inject({ method: "POST", url: `${URL}/2026-10`, headers: READ });

  expect(res.statusCode).toBe(400);
  const overview = await app.inject({ method: "GET", url: URL, headers: READ });
  expect(overview.json().submitted).toEqual([]);
});

test("keeps the first acknowledgement when a month is recorded twice", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T00:00:00.000Z"));
  const app = await build();
  await app.inject({ method: "POST", url: `${URL}/2026-09`, headers: READ });

  vi.setSystemTime(new Date("2026-10-06T00:00:00.000Z"));
  const res = await app.inject({ method: "POST", url: `${URL}/2026-09`, headers: READ });

  expect(res.statusCode).toBe(201);
  const overview = await app.inject({ method: "GET", url: URL, headers: READ });
  expect(overview.json().submitted).toEqual([{ month: "2026-09", submittedAt: "2026-10-05T00:00:00.000Z" }]);
});

test("does not serve the report, which lives at /api/v1/report", async () => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: `${URL}/report`, headers: READ });

  expect(res.statusCode).toBe(404);
});
