import { X509Certificate } from "node:crypto";
import CryptoJS from "crypto-js";
import NodeRSA from "node-rsa";

/**
 * Why a step failed. This is all the receiver ever logs about a rejected
 * certificate: the certificate is the customer's license, so neither it nor
 * anything decoded from it may reach a log line or a response body.
 */
export type LicenseCertErrorCode = "PARSE_FAILED" | "INVALID_ISSUER" | "DECRYPTION_FAILED" | "SIGNATURE_INVALID";

export class LicenseCertError extends Error {
  constructor(
    message: string,
    readonly code: LicenseCertErrorCode,
  ) {
    super(message);
    this.name = "LicenseCertError";
  }
}

/** The wire format: base64 of this JSON. */
interface LicenseContainer {
  licenseKey: string;
  x509: string;
}

// The three `||`-separated parts between the LICENSE KEY markers. `[^|]+`
// rather than `.+` so a stray separator cannot shift the split.
const LICENSE_KEY_PATTERN =
  /^-----BEGIN LICENSE KEY-----(?<encryptedSymmetricKey>[^|]+)\|\|(?<encryptedData>[^|]+)\|\|(?<signature>[^|]+)-----END LICENSE KEY-----$/;

/**
 * Proves that `containerStr` is a license certificate issued by one of
 * `issuers`. Resolves to nothing: the design uses the certificate as proof of
 * possession only, so no field is extracted for the caller.
 *
 * Steps, each failing with its own {@link LicenseCertErrorCode}:
 * 1. base64 → `{ x509, licenseKey }`
 * 2. the `x509` leaf was issued by, and its signature verifies against, an issuer
 * 3. the leaf's public key recovers the symmetric key
 * 4. the symmetric key decrypts the payload
 * 5. the leaf's public key verifies the payload signature
 *
 * Deliberately not checked: expiry, termination, clock skew, entitlements,
 * tenant, fingerprint. An expired instance is still a licensed instance and
 * its reports are still wanted.
 *
 * @throws {LicenseCertError}
 */
export function verifyLicenseCert(containerStr: string, issuers: readonly X509Certificate[]): void {
  const { x509, licenseKey } = parseContainer(containerStr);
  const leaf = parseLeaf(x509);

  if (!issuers.some((issuer) => leaf.checkIssued(issuer) && leaf.verify(issuer.publicKey))) {
    throw new LicenseCertError("certificate was not issued by an approved issuer", "INVALID_ISSUER");
  }

  // node-rsa v2 defaults to PSS; the license server signs with PKCS#1 v1.5.
  const key = new NodeRSA(leaf.publicKey.export({ format: "pem", type: "pkcs1" }), undefined, {
    signingScheme: "pkcs1",
  });

  verifyLicenseKey(key, licenseKey);
}

function parseContainer(containerStr: string): LicenseContainer {
  // Shorter than this cannot hold a certificate and a key, so fail before base64.
  if (typeof containerStr !== "string" || containerStr.length < 50) {
    throw new LicenseCertError("certificate string is missing or too short", "PARSE_FAILED");
  }

  let container: unknown;
  try {
    container = JSON.parse(Buffer.from(containerStr, "base64").toString("ascii"));
  } catch {
    throw new LicenseCertError("certificate container is not base64 JSON", "PARSE_FAILED");
  }

  if (!isContainer(container)) {
    throw new LicenseCertError("certificate container lacks licenseKey or x509", "PARSE_FAILED");
  }

  return container;
}

function isContainer(value: unknown): value is LicenseContainer {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as LicenseContainer).licenseKey === "string" &&
    typeof (value as LicenseContainer).x509 === "string"
  );
}

function parseLeaf(x509: string): X509Certificate {
  try {
    return new X509Certificate(x509);
  } catch {
    throw new LicenseCertError("x509 certificate could not be parsed", "PARSE_FAILED");
  }
}

function verifyLicenseKey(key: NodeRSA, licenseKey: string): void {
  const match = licenseKey.replace(/\r?\n|\r/g, "").match(LICENSE_KEY_PATTERN);
  if (!match?.groups) {
    throw new LicenseCertError("license key format is invalid", "PARSE_FAILED");
  }

  const { encryptedSymmetricKey, encryptedData, signature } = match.groups;

  let symmetricKey: string;
  try {
    // "Encrypted" with the issuer's private key, so the public key recovers it.
    symmetricKey = key.decryptPublic(encryptedSymmetricKey, "utf8");
  } catch {
    throw new LicenseCertError("symmetric key could not be recovered", "DECRYPTION_FAILED");
  }

  let payload: string;
  try {
    payload = CryptoJS.AES.decrypt(encryptedData, symmetricKey).toString(CryptoJS.enc.Utf8);
  } catch {
    throw new LicenseCertError("payload could not be decrypted", "DECRYPTION_FAILED");
  }

  // A wrong key yields an empty string rather than throwing, so treat it alike.
  if (payload.length === 0) {
    throw new LicenseCertError("payload could not be decrypted", "DECRYPTION_FAILED");
  }

  if (!key.verify(Buffer.from(payload), signature, "utf8", "base64")) {
    throw new LicenseCertError("payload signature is invalid", "SIGNATURE_INVALID");
  }
}

/**
 * Splits one string holding any number of PEM certificates, as an env var
 * carrying a bundle does, into X509 objects.
 *
 * @throws {Error} naming the offending block when one does not parse
 */
export function parseIssuerCertsPem(pemBundle: string): X509Certificate[] {
  const blocks = pemBundle.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];

  return blocks.map((block, index) => {
    try {
      return new X509Certificate(block);
    } catch (error) {
      throw new Error(`issuer certificate #${index + 1} could not be parsed: ${(error as Error).message}`);
    }
  });
}
