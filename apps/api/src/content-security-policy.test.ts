import { expect, test } from "vitest";
import { contentSecurityPolicy } from "./content-security-policy";

test("allows only this service without a report destination", () => {
  expect(contentSecurityPolicy(undefined)).toBe(
    "default-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'",
  );
});

test("allows the report destination's origin, not just its path", () => {
  const policy = contentSecurityPolicy({ url: "https://n8n.example.com/webhook/usage", authToken: "secret" });

  expect(policy).toContain("connect-src 'self' https://n8n.example.com;");
});
