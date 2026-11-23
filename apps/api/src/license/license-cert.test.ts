import { X509Certificate } from "node:crypto";
import { expect, test } from "vitest";
import {
  buildContainer,
  DEFAULT_MOCK_CONSUMER_ID,
  generateMockCa,
  generateMockLicense,
  generateMockLicenseWithForgedIssuer,
  generateMockLicenseWithTamperedPayload,
  TEST_CA,
} from "../test-utils/mock-license";
import { N8N_LICENSE_ISSUER_CERT_PEM } from "./issuer-cert";
import { consumerIdOf, LicenseCertError, verifyLicenseCert } from "./license-cert";

const trusted = new X509Certificate(TEST_CA.certPem);

function codeOf(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof LicenseCertError) return error.code;
    throw error;
  }
  throw new Error("expected verifyLicenseCert to throw");
}

test("accepts a certificate signed by a trusted issuer", () => {
  expect(() => verifyLicenseCert(generateMockLicense(), trusted)).not.toThrow();
});

test("accepts an expired certificate, since expiry is not this check's concern", () => {
  expect(() => verifyLicenseCert(generateMockLicense({ expired: true }), trusted)).not.toThrow();
});

test("rejects a well-formed certificate from an untrusted issuer", () => {
  expect(codeOf(() => verifyLicenseCert(generateMockLicenseWithForgedIssuer(), trusted))).toBe("INVALID_ISSUER");
});

test("rejects a payload that was altered after signing", () => {
  expect(codeOf(() => verifyLicenseCert(generateMockLicenseWithTamperedPayload(), trusted))).toBe("SIGNATURE_INVALID");
});

test("rejects input that is not a certificate container", () => {
  const cases: Record<string, string> = {
    empty: "",
    short: "abc",
    "not base64 json": "x".repeat(80),
    "json without the two fields": Buffer.from(JSON.stringify({ hello: "world", pad: "x".repeat(60) })).toString(
      "base64",
    ),
    "garbage x509": Buffer.from(JSON.stringify({ licenseKey: "x".repeat(60), x509: "not a cert" })).toString("base64"),
  };

  for (const [description, input] of Object.entries(cases)) {
    expect(
      codeOf(() => verifyLicenseCert(input, trusted)),
      description,
    ).toBe("PARSE_FAILED");
  }
});

test("rejects a license key whose symmetric key was not produced by the leaf's key", () => {
  // Chain to the trusted CA, but a key blob from a different key pair.
  const other = generateMockCa("other.example");
  const otherContainer = JSON.parse(Buffer.from(buildContainer("{}", other), "base64").toString());
  const genuine = JSON.parse(Buffer.from(generateMockLicense(), "base64").toString());
  const mixed = Buffer.from(JSON.stringify({ licenseKey: otherContainer.licenseKey, x509: genuine.x509 })).toString(
    "base64",
  );

  expect(codeOf(() => verifyLicenseCert(mixed, trusted))).toBe("DECRYPTION_FAILED");
});

test("the embedded n8n issuer certificate parses and is a CA valid until 2049", () => {
  const issuer = new X509Certificate(N8N_LICENSE_ISSUER_CERT_PEM);

  expect(issuer.subject).toContain("license.n8n.io");
  expect(new Date(issuer.validTo).getFullYear()).toBe(2049);
});

test("returns the signed payload", () => {
  const payload = verifyLicenseCert(generateMockLicense(), trusted);

  expect(JSON.parse(payload)).toMatchObject({ consumerId: DEFAULT_MOCK_CONSUMER_ID });
});

test("reads the consumerId from a verified payload", () => {
  const payload = verifyLicenseCert(generateMockLicense({ consumerId: DEFAULT_MOCK_CONSUMER_ID }), trusted);

  expect(consumerIdOf(payload)).toBe(DEFAULT_MOCK_CONSUMER_ID);
});

test("keeps the legacy zero UUID", () => {
  const zero = "00000000-0000-0000-0000-000000000000";
  const payload = verifyLicenseCert(generateMockLicense({ consumerId: zero }), trusted);

  expect(consumerIdOf(payload)).toBe(zero);
});

test("keeps an uppercase UUID unchanged", () => {
  const upper = "867A53A5-F61D-46EA-8087-CA249B06528E";
  const payload = verifyLicenseCert(generateMockLicense({ consumerId: upper }), trusted);

  expect(consumerIdOf(payload)).toBe(upper);
});

function payloadInvalidCode(payload: string): string {
  try {
    consumerIdOf(verifyLicenseCert(buildContainer(payload), trusted));
  } catch (error) {
    if (error instanceof LicenseCertError) return error.code;
    throw error;
  }
  throw new Error("expected consumerIdOf to throw");
}

test("rejects a payload that is not JSON", () => {
  expect(payloadInvalidCode("not-json")).toBe("PAYLOAD_INVALID");
});

test("rejects a payload that is not an object", () => {
  expect(payloadInvalidCode("[]")).toBe("PAYLOAD_INVALID");
});

test("rejects a payload with no consumerId", () => {
  expect(payloadInvalidCode("{}")).toBe("PAYLOAD_INVALID");
});

test("rejects an empty consumerId", () => {
  expect(payloadInvalidCode(JSON.stringify({ consumerId: "" }))).toBe("PAYLOAD_INVALID");
});

test("rejects a consumerId that is not a string", () => {
  expect(payloadInvalidCode(JSON.stringify({ consumerId: 1 }))).toBe("PAYLOAD_INVALID");
});

test("rejects a consumerId that is not a UUID", () => {
  expect(payloadInvalidCode(JSON.stringify({ consumerId: "someone-else" }))).toBe("PAYLOAD_INVALID");
});

test("does not include the rejected consumerId in the error", () => {
  const value = "someone-else";
  expect(() => consumerIdOf(JSON.stringify({ consumerId: value }))).toThrowError(
    expect.objectContaining({ code: "PAYLOAD_INVALID", message: expect.not.stringContaining(value) }),
  );
});
