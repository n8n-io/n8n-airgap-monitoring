# Airgap Monitoring Dashboard

Local-only view of a report downloaded from `GET /api/v1/report`.

## Inspect a report

From the repository root:

```sh
pnpm inspect --file=./report.json
```

## Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
pnpm test
```

## Lint with [Oxlint](https://oxc.rs/docs/guide/usage/linter) and [ESLint](https://eslint.org/)

Fixes what it can in place; `pnpm lint:check` only reports.

```sh
pnpm lint
```
