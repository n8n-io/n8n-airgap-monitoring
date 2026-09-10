# Diagrams

## n8n instance reports data to airgap-monitoring service

The service exposes a single write endpoint, `POST /api/v1/instance-reports`.
A self-hosted n8n instance posts one report per day to it; the operator sets the
same secret on both sides (`N8N_INSTANCE_REPORTING_AUTH_TOKEN` on n8n,
`N8N_MONITORING_WRITE_TOKEN` here).

The diagram shows the happy path only. The endpoint also answers `401` for a
missing or wrong token, `400` for a body the schema rejects, and `409` when an
already-accepted `batchId` is repeated for the same `instanceId`.

```mermaid
---
config:
  sequence:
    noteAlign: left
---
sequenceDiagram
    autonumber
    participant N8N as Self-hosted n8n<br/>InstanceReportingService
    participant API as airgap-monitoring<br/>POST /api/v1/instance-reports
    participant DB as SQLite<br/>instance_reports

    Note over N8N: Scheduled once a day.
    N8N->>N8N: findTodaysPending() or createPending(collectDataPoints())
    Note right of N8N: An envelope is immutable. A retry resends the<br/>pending report verbatim under the same batchId<br/>instead of re-measuring.

    N8N->>API: POST /api/v1/instance-reports<br/>Authorization: Bearer N8N_INSTANCE_REPORTING_AUTH_TOKEN<br/>Content-Type: application/json

    Note over N8N,API: Body<br/>instanceId - instanceSettings.instanceId, the reporting identity<br/>batchId - id of the pending report row on the n8n side<br/>label - optional, N8N_INSTANCE_REPORTING_IDENTIFIER, omitted when unset<br/>n8nVersion - N8N_VERSION<br/>dataPoints - non-empty array, each entry either<br/>kind cumulative: name, value<br/>kind daily: name, value, date as YYYY-MM-DD

    Note over N8N,API: Example data - what an n8n instance sends today<br/>"dataPoints": [<br/>{<br/>"kind": "cumulative",<br/>"name": "billableExecutions",<br/>"value": 402931<br/>},<br/>{<br/>"kind": "daily",<br/>"name": "billableExecutions",<br/>"value": 15234,<br/>"date": "2026-03-25"<br/>}<br/>]<br/>The cumulative point is the lifetime total, the daily point covers the previous completed UTC day.

    API->>API: bearer-auth: token equals N8N_MONITORING_WRITE_TOKEN
    API->>DB: INSERT INTO instance_reports<br/>(instanceId, batchId, label, n8nVersion, data, ReceivedAt)
    Note over DB: Append-only event store.<br/>dataPoints stored as a JSON blob.<br/>UNIQUE (instanceId, batchId).
    DB-->>API: lastInsertRowid
    API-->>N8N: 201 Created, body carries the stored event id

    N8N->>N8N: markDelivered(batchId)
```

### Example payload

The two data points every n8n report carries today, for the last completed UTC day:

```http
POST /api/v1/instance-reports HTTP/1.1
Authorization: Bearer <shared token>
Content-Type: application/json
```

```json
{
  "instanceId": "450b5c8502c2a390dba93257bde5fe7eb39397d43d8b307e8626f9d84b19e4d2",
  "batchId": "a1b2c3d4",
  "label": "prod",
  "n8nVersion": "1.99.0",
  "dataPoints": [
    { "kind": "cumulative", "name": "billableExecutions", "value": 402931 },
    {
      "kind": "daily",
      "name": "billableExecutions",
      "value": 15234,
      "date": "2026-03-25"
    }
  ]
}
```

`dataPoints` is open: metric names are chosen by the reporting instance, so only
the envelope (`cumulative` vs `daily`) is pinned down by the schema. The n8n
implementation is in
[`instance-reporting.service.ts`](https://github.com/n8n-io/n8n/blob/3c1f4a6a08d419bfb78a158fbcab68f158bde1c2/packages/cli/src/modules/instance-reporting/instance-reporting.service.ts#L52-L93).

## Download collected data via http endpoint

To be added as part of https://linear.app/n8n/issue/API-203/add-endpoint-to-download-instance-report