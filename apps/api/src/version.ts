import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The version of this service, stamped into the API's package.json by scripts/set-release-version.sh.
 * Read from disk rather than imported, as the file sits outside rootDir. `../package.json` resolves
 * from both src (tests) and dist (dev and the image, where `pnpm deploy` ships it as /app/package.json).
 */
export const airgapMonitoringVersion: string = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf8"),
).version;
