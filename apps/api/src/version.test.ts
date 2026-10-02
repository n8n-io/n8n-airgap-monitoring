import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { airgapMonitoringVersion } from "./version";

test("matches the release version in the root package.json", () => {
  const root = JSON.parse(readFileSync(join(__dirname, "../../../package.json"), "utf8"));

  expect(airgapMonitoringVersion).toBe(root.version);
});
