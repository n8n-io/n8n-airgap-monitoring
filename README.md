# n8n Airgap Monitoring

Central Monitoring for Airgapped Environments (CMFAE). Collects instance reports
from self-hosted n8n instances that cannot reach n8n's own backend, so a single
customer-hosted instance can aggregate usage numbers for many n8n instances.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `N8N_INSTANCE_AUTH_TOKEN` | yes | — | Shared bearer token that reporting n8n instances must present. The service refuses to start without it. |
| `N8N_DASHBOARD_AUTH_TOKEN` | yes | — | Bearer token the dashboard UI must present to read instance reports. Separate from the instance token so a leaked dashboard login can't be used to forge billing reports. |
| `N8N_DB_PATH` | no | `./data/cmfae.sqlite` | SQLite file holding the usage events. Point this at a mounted volume so reports survive container restarts. |
| `N8N_DASHBOARD_DIST` | no | — | Directory holding the built dashboard. When set, the API serves the dashboard from the same origin; when unset it serves the API only. The Docker image sets this for you. |

## Reporting usage

Each n8n instance sets `N8N_USAGE_METRICS_REPORTING_WEBHOOK_URL` to this
service's `POST /api/v1/instance-report` endpoint and sends one report per day:

```http
POST /api/v1/instance-report
Authorization: Bearer <N8N_INSTANCE_AUTH_TOKEN>
Content-Type: application/json

{
  "instanceId": "450b5c8502c2a390dba93257bde5fe7eb39397d43d8b307e8626f9d84b19e4d2",
  "label": "prod",
  "n8nVersion": "1.99.0",
  "dataPoints": [
    { "kind": "cumulative", "name": "activeWorkflows", "value": 87 },
    {
      "kind": "daily",
      "name": "prodExecutions",
      "value": 15234,
      "batchId": "a1b2c3d4",
      "date": "2026-03-25"
    }
  ]
}
```

`label` is optional, human-readable, and purely cosmetic: `instanceId` remains
the identity, so relabeling an instance never splits or merges its history. It
is customer-chosen free text and should be treated as untrusted display data by any consumer.

`dataPoints` is an open array of metric name to value, so instances can report
new metrics without a change here. Each entry is one of:

- `cumulative` — a running total maintained by the instance (e.g. lifetime
  execution count). Can regress after a customer-side DB rollback.
- `daily` — a value covering a single UTC calendar day (e.g. billable
  executions for that day), identified by a `batchId` (generated on the
  reporting instance, distinguishes a retry of the same day from two
  instances that happen to share an `instanceId`) and the `date` it covers.
  Scoping to a day bounds the damage of a customer-side DB rollback to the
  affected days instead of corrupting a lifetime counter.

Values may be counters, percentages or decimals, and may increase or decrease
between reports.

Responses are `201` with the stored event id, `400` for a malformed report,
and `401` for a missing or wrong token. Every report is appended as its own
event rather than overwriting the previous one, so usage history stays
auditable; a reporting UI would read the newest event per instance.

## Dashboard authentication

The dashboard UI checks a typed secret against `GET /api/v1/auth/check`
before treating a login as successful:

```http
GET /api/v1/auth/check
Authorization: Bearer <N8N_DASHBOARD_AUTH_TOKEN>
```

`204` means the token is valid; `401` means it is missing or wrong. This is a
dedicated endpoint rather than reusing a data endpoint so that checking a
login never has the side effect of fetching (or requiring) the full instance
report list. Every other dashboard-facing endpoint is guarded by the same
`N8N_DASHBOARD_AUTH_TOKEN`.

## Available Scripts

In the project directory, you can run:

### `pnpm dev`

To start the app in dev mode.

### `pnpm start`

For production mode

### `pnpm test`

Run the test cases.

## Docker

The [`Dockerfile`](Dockerfile) builds one image containing both the API and the built dashboard: the API serves the SPA from the same origin, so a deployment is a single container plus a single volume for the SQLite file.
There is no nginx to run, no second service, and no CORS configuration.

Defaults baked into the image:

| | |
| --- | --- |
| Port | `3000` |
| Data | `/data` (declared as a volume, `N8N_DB_PATH=/data/cmfae.sqlite`) |
| Dashboard | `/app/public` (`N8N_DASHBOARD_DIST`) |
| User | `node` (non-root, uid 1000) |
| Health | `HEALTHCHECK` polling `/healthz` |

The two auth tokens are deliberately **not** set.
The service refuses to boot without them rather than defaulting to open access, so you must supply both.

### Running the image locally

`docker compose up --build` builds the image and starts it on [http://localhost:3000](http://localhost:3000) with throwaway tokens and a named volume:

```sh
docker compose up --build
```

This runs the real production image — it is not a hot-reload setup.
`pnpm dev` remains the development workflow; use compose when you want to check that the thing you are about to ship actually works.
`docker compose down -v` removes the container and its data volume.

The compose file uses a named volume rather than a bind mount on purpose: the container runs as `node`, and a host directory bind-mounted on macOS or Linux generally has the wrong owner, so SQLite fails to create its WAL files.

### Deploying to your own infrastructure

Released images are published to Docker Hub as [`n8n-io/n8n-airgap-monitoring`](https://hub.docker.com/r/n8n-io/n8n-airgap-monitoring), built for `linux/amd64` and `linux/arm64`.
Pin a version tag rather than `latest`, so a redeploy never silently changes what is running:

```sh
docker pull n8n-io/n8n-airgap-monitoring:0.1.0
```

Run it with real secrets and persistent storage:

```sh
docker run -d --name n8n-airgap-monitoring --restart unless-stopped \
  -p 3000:3000 \
  -e N8N_INSTANCE_AUTH_TOKEN="$(openssl rand -hex 32)" \
  -e N8N_DASHBOARD_AUTH_TOKEN="$(openssl rand -hex 32)" \
  -v cmfae-data:/data \
  n8n-io/n8n-airgap-monitoring:0.1.0
```

#### Getting the image into an airgapped environment

The host running this service usually cannot reach Docker Hub either.
Pull on a connected machine, move the image as a file, and load it on the target:

```sh
# on a machine with internet access — --platform matters if it differs from the target
docker pull --platform linux/amd64 n8n-io/n8n-airgap-monitoring:0.1.0
docker save n8n-io/n8n-airgap-monitoring:0.1.0 \
  | gzip > n8n-airgap-monitoring-0.1.0.tar.gz

# transfer, then on the target host
docker load < n8n-airgap-monitoring-0.1.0.tar.gz
```

If you run an internal registry, retag and push it there instead (`docker tag n8n-io/n8n-airgap-monitoring:0.1.0 registry.internal/n8n-airgap-monitoring:0.1.0`) so your orchestrator can pull it normally.
