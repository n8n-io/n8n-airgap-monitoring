import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "api",
    // Pinned, not defaulted: Vitest only sets NODE_ENV=test when the shell has
    // not, and the license-auth plugin honours TEST_LICENSE_ISSUER_CERT only
    // under NODE_ENV=test.
    env: { NODE_ENV: "test" },
  },
});
