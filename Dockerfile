# One image holding the API: an airgapped customer runs a single container and a
# single volume for the SQLite file. There is no frontend in this service.

FROM node:26-slim AS build

WORKDIR /repo

# Manifests first, so a source-only change reuses the cached install layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/

# Keep this in sync with "packageManager" field in the root package.json.
RUN npm install -g pnpm@12.3.4
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm turbo run build

# Self-contained API: its dist plus a pruned production node_modules, including
# fastify-cli and sqlite3, whose install script downloaded the linux prebuild
# above, so no compiler toolchain is needed here. `--legacy` because the
# workspace does not use injected dependencies, which pnpm's deploy assumes.
RUN pnpm deploy --legacy --filter api --prod /out


FROM node:26-slim AS runtime

WORKDIR /app
COPY --from=build --chown=node:node /out ./

ENV NODE_ENV=production
ENV N8N_DB_PATH=/data/database.sqlite
# N8N_MONITORING_READ_TOKEN is deliberately unset: the API refuses to boot
# without it rather than defaulting to open access. N8N_MONITORING_WRITE_TOKEN
# is optional and selects the mode: unset, reporting instances authenticate
# with their n8n license certificate; set, they must present this token as a
# bearer header and certificates are not accepted.

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
