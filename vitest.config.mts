import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/*"],
    // Coverage is a cross-project concern, so it is configured here at the root
    // rather than per app, and `pnpm test:coverage` runs it across every app.
    coverage: {
      provider: "v8",
      // text -> prints the coverage table into the CI log (and local runs)
      // lcov -> consumed by Codecov and report tooling
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["apps/*/src/**/*.ts"],
      // Tests, type-only barrels and the test harness carry no logic worth
      // measuring; excluding them keeps the percentage honest.
      exclude: ["**/*.test.ts", "**/index.ts", "**/testing/**"],
    },
  },
});
