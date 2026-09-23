// Measures how long one certificate verification blocks the event loop.
// verifyLicenseCert is synchronous, so its duration per call is the time every
// other request, including /healthz, waits behind a report.
//
//   pnpm --filter api bench
//
// The real issuer key is RSA-4096 and a real certificate stays under 9 KB, so
// the worst case uses both. The 2048-bit case matches the test mocks, for
// comparison.
import { X509Certificate } from "node:crypto";
import { bench, describe } from "vitest";
import { buildContainer, generateMockCa } from "../test-utils/mock-license";
import { verifyLicenseCert } from "./license-cert";

/** The largest certificate the receiver has to support. */
const MAX_CERT_BYTES = 9 * 1024;

function payloadWithFlags(count: number): string {
  const features: Record<string, boolean> = {};
  for (let i = 0; i < count; i++) features[`feat:some-feature-flag-${i}`] = true;
  return JSON.stringify({ consumerId: "bench", entitlements: [{ features }] });
}

/**
 * A certificate container of close to, but not over, `containerBytes`. The
 * payload is base64-encoded twice (AES output, then the container), so each
 * payload byte costs about 16/9 container bytes on top of a fixed overhead.
 */
function fixture(keyBits: number, containerBytes: number) {
  const ca = generateMockCa("bench.license.n8n.io", keyBits);
  const overhead = buildContainer(payloadWithFlags(0), ca).length;
  const bytesPerFlag = (payloadWithFlags(100).length - payloadWithFlags(0).length) / 100;
  let flags = Math.floor(((containerBytes - overhead) * 9) / 16 / bytesPerFlag);

  let container = buildContainer(payloadWithFlags(flags), ca);
  while (container.length > containerBytes) {
    flags -= 5;
    container = buildContainer(payloadWithFlags(flags), ca);
  }
  return { issuer: new X509Certificate(ca.certPem), container };
}

describe("verifyLicenseCert", () => {
  const cases = [
    { name: "RSA-4096, 9 KB (production worst case)", ...fixture(4096, MAX_CERT_BYTES) },
    { name: "RSA-2048, 3 KB (test mock)", ...fixture(2048, 3 * 1024) },
  ];

  for (const { name, issuer, container } of cases) {
    bench(`${name}, actual ${(container.length / 1024).toFixed(1)} KB`, () => verifyLicenseCert(container, issuer), {
      time: 2000,
      warmupIterations: 200,
    });
  }
});
