# User Guide: How to use n8n-airgap-monitoring

This guide walks you through setting up usage reporting for a fleet of
self-hosted n8n instances in airgapped environments.

It takes three steps:

1. Self-host n8n-airgap-monitoring
2. Set env vars on your n8n instances so they report to it
3. Download the usage report and share it with n8n

At the end you will find a reference of all environment variables and a short
guide on how to monitor that everything is healthy.

## What is it?

n8n-airgap-monitoring is a small service that runs in your cloud environment.
All your self-hosted n8n instances send it one usage report
per day. The service stores those reports in a single SQLite database and lets
you download usage reports as JSON files, which you can then share with
n8n.

It serves as a standardized method on how usage data of your airgapped n8n instances
is shared with n8n, which supports us in providing a smooth experience for airgapped use cases.

The n8n-airgap-monitoring service is hosted as one container with one volume.
It is deliberately simple in order to make it easy to use.

## 1. Self-host n8n-airgap-monitoring

The service ships as a single Docker image:

```
ghcr.io/n8n-io/n8n-airgap-monitoring:<version>
```

In order to run, the service needs:

- **One secret token**, `N8N_MONITORING_READ_TOKEN`, which you generate
  yourself and pass as an environment variable. It is a plain string, needed
  to download the fleet report, sent verbatim in the
  `Authorization: Bearer <token>` header. There is no write token: a reporting
  n8n instance authenticates with its n8n license certificate, which it already
  holds, so nothing has to be distributed to the instances.
- **A persistent volume mounted at `/data`**, on SSD-backed storage. It holds
  the SQLite database, the only copy of your usage history, so include it in
  your backups.
- **Port 3000** reachable from every n8n instance. If that path leaves a trusted
  network, terminate TLS in front of the service: the read token travels as a
  bearer header and each report carries the instance's license certificate.
  Make sure any proxy in front of the service does not log request bodies.

A single replica of this service is optimized to handle thousands of n8n
instances reporting to it. The SQLite database only supports one writer, so do
not run more than one replica.

**For kubernetes users:** [charts/airgap-monitoring/](charts/airgap-monitoring/) contains
a reference Helm chart with production defaults that handles all of the above.
See its [README](charts/airgap-monitoring/README.md).

### Monitoring service health

The service exposes an unauthenticated `GET /healthz` endpoint that answers
`{"status":"ok"}` while it is running. Point your uptime monitoring at it. The
Docker image already uses it for its `HEALTHCHECK`, and the reference Helm chart wires it
into the liveness and readiness probes. The section
[Monitoring the health of n8n-airgap-monitoring](#monitoring-the-health-of-n8n-airgap-monitoring)
at the end covers what else to watch.

## 2. Configure your self-hosted n8n instances to report to n8n-airgap-monitoring

In order to enable the `instance-reporting` module, your n8n instance needs to be on a version whose instance-reporting module sends the license certificate. Check the n8n release notes for the exact version.

The airgapped instance reporting is an opt-in n8n module. On **every** n8n instance that should report, set:

```sh
N8N_ENABLED_MODULES=instance-reporting
N8N_INSTANCE_REPORTING_BASE_URL=https://airgap-monitoring.acme.com
N8N_INSTANCE_REPORTING_LABEL=<optional label that will be included in reports>
```

Notes:

- The instance authenticates with its license certificate, the value of
  `N8N_LICENSE_CERT`. It must be a certificate issued by n8n. An expired
  certificate is still accepted. An instance without a license certificate
  (community edition) does not report; n8n logs a warning instead.
- `N8N_INSTANCE_REPORTING_BASE_URL` is the origin only. The n8n instance will append
  the path of the reporting endpoint itself.
- If `N8N_ENABLED_MODULES` already lists other modules, add
  `instance-reporting` to the comma-separated list rather than replacing it.
- The `insights` module must stay enabled (it is enabled by default). The daily figure comes from its data.
- The label is free text shown in the report to help you tell instances apart.
  It is cosmetic. The instance id stays the identity, so relabeling an instance
  never splits or merges its history.
- In a multi-main (queue mode) setup, set the variables on all main instances.

### What to expect

- Each instance picks a random report time after 03:00 UTC on first
  boot with the module enabled and keeps reporting daily at that time forever. This spreads out the requests of many n8n self-hosted instances to the n8n-airgap-monitoring service across the day.
  The first report of an instance will therefore arrive within 24 hours of activating the module.
- If an instance was down or the n8n-airgap-monitoring service was unreachable, the next report
  carries the data of the missed days, up to 30 days. Nothing is lost for
  outages shorter than that.

## 3. Download usage reports from n8n-airgap-monitoring

The service exposes an endpoint to download the collected data as a JSON file at

```
GET <url-of-self-hosted-airgap-monitoring-service>/api/v1/report
```

The request must carry the **read token** as a bearer token in the
`Authorization` header.

The file contains one entry per instance, with when it was first and last
seen and every value it ever reported for each metric:

```json
{
  "data": {
    "generatedAt": "2026-09-03T14:30:00.000Z",
    "instances": [
      {
        "instanceId": "450b5c85…",
        "label": "acme prod",
        "firstSeen": "2026-03-20T02:00:00.000Z",
        "lastReportAt": "2026-03-26T02:00:00.000Z",
        "dataPoints": {
          "billableExecutions": [
            { "kind": "daily", "date": "2026-03-25", "value": 15234, "batchId": "…", "receivedAt": "…" },
            { "kind": "cumulative", "value": 1203987, "batchId": "…", "receivedAt": "…" }
          ]
        }
      }
    ]
  }
}
```

As of today the report always contains the complete history. In a future update we're adding a default threshold for the "time to look back" as well as a query parameter to specify the time window to include in the report.

## Environment variable reference

### On the n8n-airgap-monitoring instance

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `N8N_MONITORING_READ_TOKEN` | yes | none | Bearer token required to download the report. The service refuses to start without it. |
| `N8N_MONITORING_ADDITIONAL_ISSUER_CERTS` | no | none | PEM bundle of license issuers trusted in addition to the n8n license CA. Leave unset unless n8n announces a CA rotation. Every issuer here is named in a warning at start-up. |
| `N8N_DB_PATH` | no | `/data/database.sqlite` in the image | Location of the SQLite file. Must be on persistent storage. |


The token is read at start-up. After rotating it, restart the service.
Reporting instances are not affected by a rotation: they authenticate with
their license certificate, not with a token.

### On each n8n instance

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `N8N_ENABLED_MODULES` | yes | none | Must include `instance-reporting`. |
| `N8N_INSTANCE_REPORTING_BASE_URL` | yes | empty | Origin of the n8n-airgap-monitoring instance, without a path. |
| `N8N_LICENSE_CERT` | yes | empty | The instance's n8n license certificate. It is sent with every report as the credential. Already set on a licensed airgapped instance. |
| `N8N_INSTANCE_REPORTING_LABEL` | no | empty | Human-readable name shown in the report. |

## Monitoring the health of n8n-airgap-monitoring

**Is the service up?** Have your uptime monitoring poll `GET /healthz`, as
described in step 1.

**Are instances actually reporting?** The report itself is the best signal.
Download it and check `lastReportAt` per instance. An instance whose
`lastReportAt` is older than about 48 hours is not reporting: check its n8n log
for error logs from the instance-reporting module. An instance you expect but do not see at all
has never reached the n8n-airgap-monitoring service, which is usually a wrong URL or a network
policy.

**Is the n8n-airgap-monitoring service rejecting reports?** It logs every request. Look
for these status codes:

| Status | Meaning |
| --- | --- |
| `201` | Report stored. |
| `401` | Missing or invalid license certificate. Check `N8N_LICENSE_CERT` on the instance: it must be a certificate issued by n8n. The service log carries a reason code (`PARSE_FAILED`, `INVALID_ISSUER`, `DECRYPTION_FAILED`, `SIGNATURE_INVALID`) and nothing else about the certificate. |
| `400` | Malformed report. Should not happen with a supported n8n version. Report it to n8n. |
| `409` | The exact same report (same instance id and `batchId`) was sent twice. n8n instances never do this on their own, so it points to a replayed request or a cloned instance database. Nothing is stored. |

**Is the storage healthy?** Watch free space on the volume. Usage grows by about
1.5 GiB per year for 10,000 instances, so an ordinary volume alert with a
generous threshold is enough. Take a snapshot of the volume before every
upgrade, since database migrations only run forward.
