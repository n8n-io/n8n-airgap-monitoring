import * as assert from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { build } from "../testing/build-app";

const INDEX_HTML = "<!doctype html><title>dashboard</title>";

/** Stands in for `apps/dashboard/dist` as the Docker image mounts it. */
function withDashboardDist() {
  const dir = mkdtempSync(join(tmpdir(), "dashboard-dist-"));
  writeFileSync(join(dir, "index.html"), INDEX_HTML);
  process.env.N8N_DASHBOARD_DIST = dir;
  return dir;
}

afterEach(() => {
  const dir = process.env.N8N_DASHBOARD_DIST;
  delete process.env.N8N_DASHBOARD_DIST;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("stays inactive when N8N_DASHBOARD_DIST is unset", async () => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: "/some/spa/route" });

  assert.equal(res.statusCode, 404);
  assert.match(res.headers["content-type"] as string, /application\/json/);
});

test("serves index.html for an unknown non-API path", async () => {
  withDashboardDist();
  const app = await build();

  const res = await app.inject({ method: "GET", url: "/some/spa/route" });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body, INDEX_HTML);
  assert.match(res.headers["content-type"] as string, /text\/html/);
});

test("serves index.html at the root", async () => {
  withDashboardDist();
  const app = await build();

  const res = await app.inject({ method: "GET", url: "/" });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body, INDEX_HTML);
});

test("keeps a JSON 404 for an unknown API path", async () => {
  withDashboardDist();
  const app = await build();

  const res = await app.inject({ method: "GET", url: "/api/v1/nonexistent" });

  assert.equal(res.statusCode, 404);
  assert.match(res.headers["content-type"] as string, /application\/json/);
  assert.equal(JSON.parse(res.body).error, "Not Found");
});

test("still answers the health check", async () => {
  withDashboardDist();
  const app = await build();

  const res = await app.inject({ method: "GET", url: "/healthz" });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: "ok" });
});
