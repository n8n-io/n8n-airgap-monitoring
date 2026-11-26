import { afterEach, expect, test, vi } from "vitest";
import { build } from "../../../test-utils/build-app";

const URL = "/api/v1/submissions";
const READ = { authorization: "Bearer test-read-token" };

afterEach(() => {
  vi.useRealTimers();
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
  expect(res.json()).toEqual({ pending: [], upcoming: [], submitted: [] });
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

test("does not serve the report, which lives at /api/v1/report", async () => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: `${URL}/report`, headers: READ });

  expect(res.statusCode).toBe(404);
});
