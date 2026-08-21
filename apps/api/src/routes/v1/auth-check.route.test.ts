import * as assert from "node:assert";
import { test } from "vitest";
import { build } from "../../testing/build-app";

const URL = "/api/v1/auth/check";

test("answers 204 for a valid dashboard token", async () => {
  const app = await build();

  const res = await app.inject({
    method: "GET",
    url: URL,
    headers: { authorization: "Bearer test-dashboard-token" },
  });

  assert.equal(res.statusCode, 204);
  assert.equal(res.body, "");
  assert.equal(res.headers["cache-control"], "no-store");
});

test("rejects a request without a bearer token", async () => {
  const app = await build();

  const res = await app.inject({ method: "GET", url: URL });

  assert.equal(res.statusCode, 401);
});

test("rejects a request with the wrong bearer token", async () => {
  const app = await build();

  const res = await app.inject({
    method: "GET",
    url: URL,
    headers: { authorization: "Bearer not-the-token" },
  });

  assert.equal(res.statusCode, 401);
});

test("rejects a request with the instance token, since it is a different secret", async () => {
  const app = await build();

  const res = await app.inject({
    method: "GET",
    url: URL,
    headers: { authorization: "Bearer test-instance-token" },
  });

  assert.equal(res.statusCode, 401);
});
