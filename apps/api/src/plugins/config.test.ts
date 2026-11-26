import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import config from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function load() {
  const fastify = Fastify();
  await fastify.register(config);
  await fastify.ready();
  return fastify.config;
}

function stubDestination(url: string | undefined, authToken: string | undefined) {
  vi.stubEnv("N8N_MONITORING_READ_TOKEN", "read");
  vi.stubEnv("N8N_MONITORING_REPORT_DESTINATION", url);
  vi.stubEnv("N8N_MONITORING_REPORT_DESTINATION_AUTH_TOKEN", authToken);
}

test("has no report destination when neither variable is set", async () => {
  stubDestination(undefined, undefined);

  expect((await load()).reportDestination).toBeUndefined();
});

test("reads the report destination and its auth token, trimmed", async () => {
  stubDestination(" https://n8n.example.com/webhook/usage ", " secret ");

  expect((await load()).reportDestination).toEqual({
    url: "https://n8n.example.com/webhook/usage",
    authToken: "secret",
  });
});

test.each([
  ["the auth token is missing", "https://n8n.example.com/webhook/usage", undefined, /AUTH_TOKEN must be set/],
  ["the auth token is blank", "https://n8n.example.com/webhook/usage", "  ", /AUTH_TOKEN must be set/],
  ["the URL is missing", undefined, "secret", /REPORT_DESTINATION must be set/],
  ["the URL is not absolute", "n8n.example.com/webhook", "secret", /absolute URL/],
])("refuses to start when %s", async (_name, url, authToken, message) => {
  stubDestination(url, authToken);

  await expect(load()).rejects.toThrow(message);
});
