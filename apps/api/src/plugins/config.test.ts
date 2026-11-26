import Fastify from "fastify";
import { afterEach, expect, test, vi } from "vitest";
import config, { PLACEHOLDER_REPORT_UPLOAD_FORM_URL } from "./config";

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
  ["the URL is not absolute", "n8n.example.com/webhook", "secret", /absolute http/],
  ["the URL has no scheme but a port", "localhost:5678/webhook", "secret", /absolute http/],
  ["the URL is not http(s)", "ftp://n8n.example.com/usage", "secret", /absolute http/],
])("refuses to start when %s", async (_name, url, authToken, message) => {
  stubDestination(url, authToken);

  await expect(load()).rejects.toThrow(message);
});

function stubUploadFormUrl(value: string | undefined) {
  vi.stubEnv("N8N_MONITORING_READ_TOKEN", "read");
  vi.stubEnv("N8N_MONITORING_REPORT_UPLOAD_FORM_URL", value);
}

test("uses the placeholder upload form URL when the variable is not set", async () => {
  stubUploadFormUrl(undefined);

  expect((await load()).reportUploadFormUrl).toBe(PLACEHOLDER_REPORT_UPLOAD_FORM_URL);
});

test("uses the placeholder upload form URL when the variable is blank", async () => {
  stubUploadFormUrl("   ");

  expect((await load()).reportUploadFormUrl).toBe(PLACEHOLDER_REPORT_UPLOAD_FORM_URL);
});

test("reads the upload form URL, trimmed", async () => {
  stubUploadFormUrl(" https://n8n.example.com/form/usage ");

  expect((await load()).reportUploadFormUrl).toBe("https://n8n.example.com/form/usage");
});

test.each([
  ["not absolute", "n8n.example.com/form"],
  ["not a web URL", "ftp://n8n.example.com/form"],
])("refuses to start when the upload form URL is %s", async (_name, value) => {
  stubUploadFormUrl(value);

  await expect(load()).rejects.toThrow(/absolute http\(s\) URL/);
});
