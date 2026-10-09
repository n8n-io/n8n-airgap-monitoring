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
import { CONSUMER_ID_MAX_LENGTH, consumerIdOf, LicenseCertError, verifyLicenseCert } from "./license-cert";

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

test("returns the signed payload", () => {
  const payload = verifyLicenseCert(generateMockLicense({ consumerRef: "who@example.com" }), trusted);

  expect(JSON.parse(payload)).toMatchObject({ consumerRef: "who@example.com" });
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

test("consumerIdOf returns the payload's consumerId", () => {
  expect(consumerIdOf(verifyLicenseCert(generateMockLicense({ consumerId: "customer-42" }), trusted))).toBe(
    "customer-42",
  );
});

test("consumerIdOf accepts a consumerId at the length limit", () => {
  const atLimit = "x".repeat(CONSUMER_ID_MAX_LENGTH);
  expect(consumerIdOf(verifyLicenseCert(generateMockLicense({ consumerId: atLimit }), trusted))).toBe(atLimit);
});

test("consumerIdOf keeps the all-zeros placeholder as it is", () => {
  expect(consumerIdOf(verifyLicenseCert(generateMockLicense(), trusted))).toBe(DEFAULT_MOCK_CONSUMER_ID);
});

test("consumerIdOf rejects a payload without a string consumerId", () => {
  const cases: Record<string, string> = {
    "not json": "definitely not json",
    "no consumerId": "{}",
    "empty consumerId": JSON.stringify({ consumerId: "" }),
    "numeric consumerId": JSON.stringify({ consumerId: 42 }),
    "array payload": "[]",
    "too long": JSON.stringify({ consumerId: "x".repeat(CONSUMER_ID_MAX_LENGTH + 1) }),
  };

  for (const [description, payload] of Object.entries(cases)) {
    expect(
      codeOf(() => consumerIdOf(verifyLicenseCert(buildContainer(payload), trusted))),
      description,
    ).toBe("PAYLOAD_INVALID");
  }
});

test("the embedded n8n issuer certificate parses and is a CA valid until 2049", () => {
  const issuer = new X509Certificate(N8N_LICENSE_ISSUER_CERT_PEM);

  expect(issuer.subject).toContain("license.n8n.io");
  expect(new Date(issuer.validTo).getFullYear()).toBe(2049);
});
