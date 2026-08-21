# Single image holding both apps: the Fastify API also serves the built
# dashboard, so an airgapped customer runs one container and one volume.

FROM node:24-slim AS build

# corepack honors the pnpm version pinned in the root package.json.
RUN corepack enable
WORKDIR /repo

# Manifests first, so a source-only change reuses the cached install layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY tools/tsconfig/package.json tools/tsconfig/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm turbo run build

# Self-contained API: its dist plus a pruned production node_modules, including
# fastify-cli and the better-sqlite3 prebuilt binding. `--legacy` because the
# workspace does not use injected dependencies, which pnpm 10's deploy assumes.
RUN pnpm deploy --legacy --filter api --prod /out


FROM node:24-slim AS runtime

WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --from=build --chown=node:node /repo/apps/dashboard/dist ./public

ENV NODE_ENV=production
ENV N8N_DB_PATH=/data/cmfae.sqlite
ENV N8N_DASHBOARD_DIST=/app/public
# N8N_INSTANCE_AUTH_TOKEN and N8N_DASHBOARD_AUTH_TOKEN are deliberately unset:
# the API refuses to boot without them rather than defaulting to open access.

RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 3000

# No curl or wget on slim, so probe with Node's built-in fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3000/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Not the package.json `start` script: that one runs tsc, which is not installed
# here. `-a 0.0.0.0` is required — fastify-cli otherwise binds localhost only,
# which is unreachable from outside the container.
CMD ["node_modules/.bin/fastify", "start", "--options", "-l", "info", "-a", "0.0.0.0", "dist/app.js"]
