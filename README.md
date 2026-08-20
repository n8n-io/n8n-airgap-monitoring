# n8n Airgap Monitoring

Central Monitoring for Airgapped Environments (CMFAE). Collects instance reports
from self-hosted n8n instances that cannot reach n8n's own backend, so a single
customer-hosted instance can aggregate usage numbers for many n8n instances.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `N8N_AUTH_TOKEN` | yes | — | Shared bearer token that reporting n8n instances must present. The service refuses to start without it. |
| `N8N_DB_PATH` | no | `./data/cmfae.sqlite` | SQLite file holding the usage events. Point this at a mounted volume so reports survive container restarts. |

## Reporting usage

Each n8n instance sets `N8N_USAGE_METRICS_REPORTING_WEBHOOK_URL` to this
service's `POST /api/v1/instance-report` endpoint and sends one report per day:

```http
POST /api/v1/instance-report
Authorization: Bearer <N8N_AUTH_TOKEN>
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

## Available Scripts

In the project directory, you can run:

### `pnpm dev`

To start the app in dev mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### `pnpm start`

For production mode

### `pnpm test`

Run the test cases.

