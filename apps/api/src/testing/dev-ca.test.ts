import { X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { verifyLicenseCert } from "../license/license-cert";
import { readDevCa, writeDevCa } from "./dev-ca";
import { generateMockLicense } from "./mock-license";

test("a CA written to disk mints certificates that verify against what was written", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-ca-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  const written = writeDevCa(dir);
  const read = readDevCa(dir);
  expect(read).toEqual(written);

  const issuer = new X509Certificate(read.certPem);
  expect(() => verifyLicenseCert(generateMockLicense({ ca: read }), issuer)).not.toThrow();
  // The default test CA is a different CA, so the file-backed one must not vouch for it.
  expect(() => verifyLicenseCert(generateMockLicense(), issuer)).toThrow();
});
