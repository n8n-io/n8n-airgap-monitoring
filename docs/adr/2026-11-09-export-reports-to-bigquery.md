# 14. Export reports to BigQuery

> _This ADR was written by AI and reviewed by a human._

Date: 2026-11-09

Status: Proposed

Decision Owner: Data team

## Context

n8n hosts this service, so the usage data must reach BigQuery for analysis. Today the only way out is the pull endpoint, `GET /api/v1/report` (ADR 9). Someone has to call it and move the file.

The download does not contain everything the service stores. It leaves out `n8nVersion`, and it shows only the latest label for each instance. The complete data for each batch exists only in SQLite.

The data team wants a dependency that the service team can see, and a copy that keeps every batch.

## Decision

The data team prefers option B, publishing on ingest. Both options are described so the service team can choose.

**Option A: sidecar export job.** A scheduled container next to the service calls `GET /api/v1/report` on localhost and uploads the file to a Cloud Storage bucket. A [data team owned] load job then fills a BigQuery raw table. The service code does not change. The dependency is a deployment manifest and a bucket grant.

**Option B: publish on ingest.** After a report is stored, the service publishes it to a Pub/Sub topic. A BigQuery subscription writes each message to a raw table. There is no listener and no load job.

Option B must not couple ingest to Pub/Sub. An instance retries every non-2xx response, and a retry gets a 409, because the batch is already stored. A failed publish would then lose the report for BigQuery for good. So the service writes the message to an outbox table in the same transaction as the report. A background task publishes it and retries. Delivery is at least once, and the data team dedupes on `instanceId` plus `batchId`.

Either option starts with one backfill from `GET /api/v1/report` for the history already stored.

## Alternatives Considered

**Pull from Kestra over HTTP.** Rejected: the service team does not see the dependency, and the read token is shared (ADR 9).

**Replicate the SQLite file.** Rejected: CDC tools do not read SQLite, and the data team would depend on the internal schema.

## Consequences

| | A: sidecar | B: publish on ingest |
|---|---|---|
| Change to this repo | None | Outbox table, publisher, config |
| Latency | One day | Minutes |
| `n8nVersion` per batch | No | Yes |
| Label history | No | Yes |
| Moving parts | Cron, bucket, load job | Topic, subscription, outbox |
| Failure to watch | Missed run | Outbox backlog |

- Option B adds a GCP client and credentials to a service that has none today. It needs Workload Identity or a service account, and a topic.
- The raw table keys on `batchId` in both options. A can be replaced by B later without a data migration.
- The outbox grows while Pub/Sub is down. The service needs an alert on its size.

## Links

Documentation: [USER_GUIDE.md](../USER_GUIDE.md#3-download-usage-reports-from-n8n-airgap-monitoring)

Related ADRs: [Stream the instance report](2026-09-11-stream-instance-report.md), [Report envelopes are immutable](2026-08-26-report-envelopes-are-immutable.md)
