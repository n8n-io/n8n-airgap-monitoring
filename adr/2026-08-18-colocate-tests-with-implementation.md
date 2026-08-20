# 3. Colocate tests with implementation and let feature modules own their plugin

Date: 2026-08-18

## Status

Accepted

## Context

Tests lived in a top-level `test/` mirroring `src/`, so every test reached back through `../../src/...` and a moved file left its test behind. Separately, `src/plugins/usage.ts` wired the usage service and repository together but sat away from both, only because `@fastify/autoload` scans `src/plugins/`.

## Decision

Tests live next to the code they cover as `<impl>.test.ts` (a route folder's test is named after the route, since its implementation is `index.ts`). Shared harness code lives in `src/testing/`.

Feature modules own their wiring: `src/instance-report/` holds `instance-report.plugin.ts` alongside its service, repository and tests, and `app.ts` registers it explicitly. `src/plugins/` is now infrastructure only (config, db, sensible).

## Consequences

- Both autoload calls need `ignorePattern: /\.test\.(?:ts|js)$/`; without it autoload registers test files as plugins and routes.
- `tsconfig.build.json` excludes `**/*.test.ts` and `src/testing/**` so tests do not reach `dist`; `tsconfig.json` still covers them for the editor and `pnpm typecheck`. A bare `tsc` (no `-p`) would emit tests — use `pnpm build:ts`.
- Coverage is not wired up yet; if added, the vitest/coverage config must exclude `**/*.test.ts` and `src/testing/**` so tests do not leak into the coverage report.
- Each new feature module costs one `register` call in `app.ts`. If that becomes tedious, autoload `*.plugin.*` files by convention instead.
- Routes stay in `src/routes/`, keeping autoload's URL-from-folder mapping; a feature is therefore split between its module and a thin controller.
