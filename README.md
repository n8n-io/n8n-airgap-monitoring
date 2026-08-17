# n8n Airgap Monitoring

Central Monitoring for Airgapped Environments (CMFAE). Collects usage reports
from self-hosted n8n instances that cannot reach n8n's own backend, so a single
customer-hosted instance can aggregate usage numbers for many n8n instances.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `N8N_AUTH_TOKEN` | yes | — | Shared bearer token that reporting n8n instances must present. The service refuses to start without it. |
| `N8N_DB_PATH` | no | `./data/cmfae.sqlite` | SQLite file holding the usage events. Point this at a mounted volume so reports survive container restarts. |

## Reporting usage

Each n8n instance sets `N8N_USAGE_METRICS_REPORTING_WEBHOOK_URL` to this
service's `POST /api/v1/ingest` endpoint and sends one report per day:

```http
POST /api/v1/ingest
Authorization: Bearer <N8N_AUTH_TOKEN>
Content-Type: application/json

{
  "instanceId": "bmw-prod-01",
  "n8nVersion": "1.99.0",
  "data": {
    "prodExecutions": 15234,
    "successRate": 99.5
  }
}
```

`data` is an open map of metric name to number, so instances can report new
metrics without a change here. Values may be counters, percentages or decimals,
and may increase or decrease between reports.

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

