# Plan: Single Docker image for airgap-monitoring (API + dashboard) + docker-compose

**Repo context:** pnpm 10.34.5 monorepo (`packageManager` field pins it, use corepack), Node ≥ 24, turbo for builds. Two apps: `apps/api` (Fastify 5, launched via `fastify-cli` from compiled `dist/app.js`, native dep `better-sqlite3`, SQLite file at `N8N_DB_PATH`) and `apps/dashboard` (Vite SPA, builds to `apps/dashboard/dist`, vue-router history mode, calls the API via relative `/api/...` paths). The API requires `N8N_INSTANCE_AUTH_TOKEN` and `N8N_DASHBOARD_AUTH_TOKEN` env vars and refuses to start without them — keep that behavior, do not add defaults.

## Step 1 — API serves the dashboard SPA

1. Add `@fastify/static` to `apps/api` dependencies (pinned exact version, matching the repo's style of exact pins).
2. Register `@fastify/static` **only when** an env var `N8N_DASHBOARD_DIST` is set and points at an existing directory. When unset (tests, API-only dev), nothing changes. Follow the existing plugin pattern in `apps/api/src/plugins/` — note the repo convention: annotate `fastify: FastifyInstance` explicitly in every `fp()` callback or the TS 7 build fails with TS7006.
3. Add an SPA fallback: a `setNotFoundHandler` that serves `index.html` for GET/HEAD requests whose path does **not** start with `/api` (and isn't `/health`); those keep their JSON 404s. Only active when static serving is active.
4. Add a test covering: static plugin inactive without the env var; with it set, an unknown non-API path returns `index.html` and an unknown `/api/v1/...` path still 404s as JSON.

## Step 2 — Dockerfile (multi-stage) at repo root

**Stage 1 `build`** — `FROM node:24-slim`:

- `corepack enable` (honors the repo's pnpm pin). No extra build packages needed — `better-sqlite3` ships glibc prebuilds for x64/arm64, so it installs without a compile step on slim.
- Copy `pnpm-lock.yaml`, `pnpm-workspace.yaml`, root `package.json`, `apps/api/package.json`, `apps/dashboard/package.json` (and `tools/*/package.json` if any exist — check), then `pnpm install --frozen-lockfile`, then copy the rest of the source and `pnpm turbo run build`.
- Then `pnpm deploy --filter api --prod /out` — produces a self-contained API dir (its `dist/` + pruned production `node_modules` incl. `fastify-cli` and the `better-sqlite3` binding).

**Stage 2 `runtime`** — `FROM node:24-slim`:

- Copy `/out` from the build stage to `/app`; copy `apps/dashboard/dist` to `/app/public`.
- `ENV N8N_DB_PATH=/data/cmfae.sqlite` and `ENV N8N_DASHBOARD_DIST=/app/public`. Do **not** set the two auth tokens.
- `VOLUME /data`; ensure `/data` and `/app` are owned by the `node` user; `USER node`.
- `EXPOSE 3000`.
- `HEALTHCHECK` using `node -e` with `fetch` against `http://localhost:3000/health` (no curl/wget in the image).
- `CMD ["node_modules/.bin/fastify", "start", "--options", "-l", "info", "-a", "0.0.0.0", "dist/app.js"]`. Critical: `-a 0.0.0.0` (fastify-cli defaults to localhost, unreachable from outside the container). Do **not** reuse the package.json `start` script — it runs `tsc`, which doesn't exist in the runtime image.

## Step 3 — `.dockerignore` at repo root

`node_modules` (all levels), `**/dist`, `data`, `.git`, plus editor/CI cruft.

## Step 4 — `docker-compose.yml` at repo root (local use of the prod image)

One service, builds the image, named volume (not a bind mount — avoids uid mismatch on macOS):

```yaml
services:
  airgap-monitoring:
    build: .
    ports:
      - "3000:3000"
    environment:
      N8N_INSTANCE_AUTH_TOKEN: dev-instance-token
      N8N_DASHBOARD_AUTH_TOKEN: dev-dashboard-token
    volumes:
      - cmfae-data:/data

volumes:
  cmfae-data:
```

This is not a hot-reload dev setup — `pnpm dev` remains the dev workflow; compose is for running the real container locally.

## Verification

1. `pnpm test` and `pnpm typecheck` pass (Step 1 changes).
2. `docker compose up --build` succeeds.
3. Smoke test: `GET /health` → 200; `GET /api/v1/auth/check` with `Authorization: Bearer dev-dashboard-token` → 204, without → 401; `GET /` → dashboard `index.html`; `GET /some/spa/route` → `index.html`; `GET /api/v1/nonexistent` → JSON 404.
4. Restart the container and confirm the SQLite data survives (named volume works).

## Explicit non-goals

No nginx, no CORS work (same origin), no pnpm store build-cache mounts, no dev-mode containers. If `better-sqlite3` unexpectedly needs to compile from source (it shouldn't on slim/glibc), add `python3 make g++` to the build stage only — do not add them preemptively.
