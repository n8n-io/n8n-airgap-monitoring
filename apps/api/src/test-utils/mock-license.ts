// Ported from ai-assistant-service's mockLicenseGenerator: mints license
// certificate containers in the exact format the license server produces,
// signed by a throwaway CA generated when this module loads.
//
// The receiver checks none of the payload's contents, so the payload is kept
// to the minimum a real certificate carries. Dates are accepted regardless of
// value, which the `expired` option exists to prove.
import { randomBytes } from "node:crypto";
import CryptoJS from "crypto-js";
import forge from "node-forge";
import NodeRSA from "node-rsa";

export interface MockCa {
  privateKeyPem: string;
  certPem: string;
}

export interface MockLicenseOptions {
  /** Signs with a different CA than the module default. */
  ca?: MockCa;
  /** Puts expiresAt and terminatesAt in the past. */
  expired?: boolean;
  consumerRef?: string;
  isEphemeral?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A self-signed certificate acting as both CA and leaf, like the ai-assistant-service mock. */
export function generateMockCa(commonName = "test.license.n8n.io", keyBits = 2048): MockCa {
  const keyPair = forge.pki.rsa.generateKeyPair(keyBits);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keyPair.publicKey;
  cert.serialNumber = randomBytes(8).toString("hex");
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: "commonName", value: commonName },
    { name: "countryName", value: "DE" },
    { shortName: "ST", value: "Berlin" },
    { name: "localityName", value: "Berlin" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true, nonRepudiation: true },
  ]);
  cert.sign(keyPair.privateKey, forge.md.sha256.create());

  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyPair.privateKey),
    certPem: forge.pki.certificateToPem(cert),
  };
}

/** The CA every test trusts by default. Generated once per process. */
export const TEST_CA: MockCa = generateMockCa();

/** Trust this on the receiver to accept certificates from {@link generateMockLicense}. */
export const TEST_ISSUER_CERT_PEM = TEST_CA.certPem;

/**
 * A base64 license certificate container, as n8n would read from
 * `N8N_LICENSE_CERT` and send as `licenseCert`.
 */
export function generateMockLicense(options: MockLicenseOptions = {}): string {
  const { ca = TEST_CA, expired = false, consumerRef = "test@airgap.dev", isEphemeral = true } = options;

  const now = Date.now();
  const validTo = new Date(now + (expired ? -1 : 365) * DAY_MS);

  const payload = JSON.stringify({
    consumerId: "00000000-0000-0000-0000-000000000000",
    consumerRef,
    version: 2,
    tenantId: 1,
    renewalToken: "",
    deviceLock: false,
    deviceFingerprint: "",
    createdAt: new Date(now - DAY_MS).toISOString(),
    issuedAt: new Date(now - DAY_MS).toISOString(),
    expiresAt: validTo.toISOString(),
    terminatesAt: validTo.toISOString(),
    managementJwt: "",
    isEphemeral,
    detachedEntitlementsCount: 0,
    entitlements: [
      {
        id: "test-entitlement-id",
        productId: "00000000-0000-0000-0000-000000000000",
        productMetadata: {},
        features: { "feat:sharing": true, "quota:users": -1 },
        featureOverrides: {},
        validFrom: new Date(now - DAY_MS).toISOString(),
        validTo: validTo.toISOString(),
        isFloatable: false,
      },
    ],
  });

  return buildContainer(payload, ca);
}

/**
 * Assembles the container from a payload string and the CA that signs it.
 * Exposed so a test can sign one payload and then tamper with it.
 */
export function buildContainer(payload: string, ca: MockCa = TEST_CA): string {
  const key = new NodeRSA(ca.privateKeyPem, "pkcs1-private-pem", { signingScheme: "pkcs1" });

  const symmetricKey = randomBytes(32).toString("hex");
  const encryptedData = CryptoJS.AES.encrypt(payload, symmetricKey).toString();
  const encryptedSymmetricKey = key.encryptPrivate(symmetricKey, "base64");
  const signature = key.sign(Buffer.from(payload), "base64", "utf8");

  const licenseKey = `-----BEGIN LICENSE KEY-----${encryptedSymmetricKey}||${encryptedData}||${signature}-----END LICENSE KEY-----`;

  return Buffer.from(JSON.stringify({ licenseKey, x509: ca.certPem })).toString("base64");
}

/** Well-formed and correctly signed, but by a CA the receiver does not trust. */
export function generateMockLicenseWithForgedIssuer(): string {
  return generateMockLicense({ ca: generateMockCa("forged.example") });
}

/**
 * Signed by the trusted CA, then re-encrypted with the payload altered, so the
 * chain and key recovery pass and only the signature check can catch it.
 */
export function generateMockLicenseWithTamperedPayload(): string {
  const genuine = decodeContainer(generateMockLicense());
  const match = genuine.licenseKey.match(
    /^(-----BEGIN LICENSE KEY-----)(.+)\|\|(.+)\|\|(.+)(-----END LICENSE KEY-----)$/,
  );
  if (!match) throw new Error("mock license key did not match its own format");

  const [, head, encryptedSymmetricKey, , signature, tail] = match;
  const key = new NodeRSA(TEST_CA.privateKeyPem, "pkcs1-private-pem", { signingScheme: "pkcs1" });
  const symmetricKey = key.decryptPublic(encryptedSymmetricKey, "utf8");
  const tampered = CryptoJS.AES.encrypt(JSON.stringify({ consumerId: "someone-else" }), symmetricKey).toString();

  return Buffer.from(
    JSON.stringify({
      licenseKey: `${head}${encryptedSymmetricKey}||${tampered}||${signature}${tail}`,
      x509: genuine.x509,
    }),
  ).toString("base64");
}

function decodeContainer(containerStr: string): { licenseKey: string; x509: string } {
  return JSON.parse(Buffer.from(containerStr, "base64").toString("ascii"));
}
