# n8n Airgap Monitoring

Central Monitoring for Airgapped Environments (CMFAE). Collects instance reports
from self-hosted n8n instances that cannot reach n8n's own backend, so a single
customer-hosted instance can aggregate usage numbers for many n8n instances.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `N8N_MONITORING_WRITE_TOKEN` | yes | — | Bearer token that reporting n8n instances must present on `POST /api/v1/instance-reports`. The service refuses to start without it. |
| `N8N_MONITORING_READ_TOKEN` | yes | — | Bearer token required to download the usage report from `GET /api/v1/instance-reports`. The service refuses to start without it. |
| `N8N_DB_PATH` | no | `./data/database.sqlite` | SQLite file holding the usage events. Point this at a mounted volume so reports survive container restarts. |

## Reporting usage

Each n8n instance sets `N8N_USAGE_METRICS_REPORTING_WEBHOOK_URL` to this
service's `POST /api/v1/instance-reports` endpoint and sends one report per day:

```http
POST /api/v1/instance-reports
Authorization: Bearer <N8N_MONITORING_WRITE_TOKEN>
Content-Type: application/json

{
  "instanceId": "450b5c8502c2a390dba93257bde5fe7eb39397d43d8b307e8626f9d84b19e4d2",
  "batchId": "a1b2c3d4",
  "label": "prod",
  "n8nVersion": "1.99.0",
  "dataPoints": [
    { "kind": "cumulative", "name": "activeWorkflows", "value": 87 },
    {
      "kind": "daily",
      "name": "prodExecutions",
      "value": 15234,
      "date": "2026-03-25"
    }
  ]
}
```

`label` is optional, human-readable, and purely cosmetic: `instanceId` remains
the identity, so relabeling an instance never splits or merges its history. It
is customer-chosen free text and should be treated as untrusted display data by any consumer.

`batchId` is generated on the reporting instance and identifies this report.
A report is immutable once sent: a retry repeats it verbatim under the same
`batchId`, pending reports are never merged or rebuilt into a new one, and an
accepted `batchId` is never sent again. That contract is what makes two
instances sharing an `instanceId` detectable — the same day reported under a
second `batchId` with a conflicting value. Repeating an accepted `batchId` is
rejected with `409 Conflict` rather than silently deduplicated. See
[adr/2026-08-26-report-envelopes-are-immutable.md](adr/2026-08-26-report-envelopes-are-immutable.md).

`dataPoints` is an open array of metric name to value, so instances can report
new metrics without a change here. Each entry is one of:

- `cumulative` — a running total maintained by the instance (e.g. lifetime
  execution count). Can regress after a customer-side DB rollback.
- `daily` — a value covering a single UTC calendar day (e.g. billable
  executions for that day), identified by the `date` it covers. Scoping to a
  day bounds the damage of a customer-side DB rollback to the affected days
  instead of corrupting a lifetime counter.

Values may be counters, percentages or decimals, and may increase or decrease
between reports.

Responses are `201` with the stored event id, `400` for a malformed report,
and `401` for a missing or wrong token. Every report is appended as its own
event rather than overwriting the previous one, so usage history stays
auditable; a reporting UI would read the newest event per instance.

## Downloading the report

A customer downloads a JSON report of everything the service has recorded and
shares it with n8n:

```http
GET /api/v1/instance-reports
Authorization: Bearer <N8N_MONITORING_READ_TOKEN>
```

Its shape is:

```json
{
  "data": {
    "generatedAt": "2026-09-03T14:30:00.000Z",
    "instances": [
      {
        "instanceId": "450b5c8502c2a390dba93257bde5fe7eb39397d43d8b307e8626f9d84b19e4d2",
        "label": "prod",
        "firstSeen": "2026-03-20",
        "lastReportAt": "2026-03-26T02:00:00.000Z",
        "dataPoints": {
          "prodExecutions": [
            { "kind": "daily", "date": "2026-03-25", "value": 15234, "batchId": "a1b2c3d4", "receivedAt": "2026-03-26T02:00:00.000Z" }
          ],
          "activeWorkflows": [
            { "kind": "cumulative", "value": 87, "batchId": "a1b2c3d4", "receivedAt": "2026-03-26T02:00:00.000Z" }
          ]
        }
      }
    ]
  }
}
```

`dataPoints` here is a map keyed by metric name — note this differs from the
same field on the ingest payload, which is a flat array. Each key holds every
value that instance reported for that metric, oldest-first, tagged with the
`batchId` and `receivedAt` of the report that carried it.

## Available Scripts

In the project directory, you can run:

### `pnpm dev`

To start the app in dev mode on [http://localhost:3456](http://localhost:3456).

The dev port is deliberately an unpopular one. Port 3000 is the default for a
long list of tools (Grafana among them) and a silent `EADDRINUSE` at startup
looks a lot like "the dev server didn't print its URL".

### `pnpm start`

For production mode

### `pnpm test`

Run the test cases.

## Docker

The [`Dockerfile`](Dockerfile) builds a single image containing the API, so a
deployment is one container plus one volume for the SQLite file. This service is
API only — there is no frontend to serve, no second process, and no CORS to
configure.

Defaults baked into the image:

| | |
| --- | --- |
| Port | `3000` |
| Data | `/data` (declared as a volume, `N8N_DB_PATH=/data/database.sqlite`) |
| User | `node` (non-root, uid 1000) |
| Health | `HEALTHCHECK` polling `/healthz` |

`N8N_MONITORING_WRITE_TOKEN` and `N8N_MONITORING_READ_TOKEN` are deliberately
**not** set. The service refuses to boot without either, so you must supply both.

### Running the image locally

`docker compose up --build` builds the image and starts it on
[http://localhost:3001](http://localhost:3001) with a throwaway token and a
named volume:

```sh
docker compose up --build          # or: docker-compose up --build
```

The host port is 3001, not 3000, since port 3000 is a popular default and often
already taken. Inside the container the API still listens on 3000.

This runs the real production image — it is not a hot-reload setup. `pnpm dev`
remains the development workflow; use compose when you want to check that the
thing you are about to ship actually works. `docker compose down -v` removes the
container and its data volume.

The compose file uses a named volume rather than a bind mount on purpose: the
container runs as `node`, and a host directory bind-mounted on macOS or Linux
generally has the wrong owner, so SQLite fails to create its WAL files.

## Local Kubernetes demo

[`scripts/local-k8s-demo/`](scripts/local-k8s-demo/) runs two n8n instances and
this service in a [kind](https://kind.sigs.k8s.io/) cluster, with the instances
reporting over cluster-internal DNS so no traffic leaves the cluster. See its
[README](scripts/local-k8s-demo/README.md).

