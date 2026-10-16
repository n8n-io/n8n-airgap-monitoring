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

Reporting n8n instances authenticate with their n8n license certificate, which
they already hold, so there is no secret to distribute. The certificate proves
"licensed by n8n", not "belongs to you", so keeping the service off the public
internet is part of its security model. See
[Network exposure](#network-exposure) below.

## 1. Self-host n8n-airgap-monitoring

The service ships as a single Docker image:

```
ghcr.io/n8n-io/n8n-airgap-monitoring:<version>
```

In order to run, the service needs:

- **A secret read token** in `N8N_MONITORING_READ_TOKEN`, which you generate
  yourself. It is a plain string that unlocks the fleet report, sent verbatim
  in the `Authorization: Bearer <token>` header of a request.
- **A persistent volume mounted at `/data`**, on SSD-backed storage. It holds
  the SQLite database, the only copy of your usage history, so include it in
  your backups.
- **A private network path** from every n8n instance and from wherever you
  download the report; see [Network exposure](#network-exposure). If that path
  leaves a trusted network, terminate TLS in front of the service: the read
  token travels as a bearer header and each report carries the instance's
  license certificate. Make sure any proxy in front of the service does not
  log request bodies.

### Network exposure

> **Warning:** The write endpoint, `POST /api/v1/instance-reports`, must only
> be reachable from your own n8n instances. Never expose it to the public
> internet. Enforce this on the network level, for example with a private
> network, firewall rules, an internal load balancer or a Kubernetes
> NetworkPolicy.

The reason is the write endpoint's authentication.
`POST /api/v1/instance-reports` accepts any valid n8n license certificate, and
every n8n customer in the world holds one. The service cannot tell your
instances from someone else's, so if it is reachable from the internet, anyone
with an n8n license can post reports into your database and pollute the usage
report you share with n8n. The details are in
[AUTHORIZATION.md](AUTHORIZATION.md#what-authorized-means). If you cannot
guarantee the network restriction, see
[Alternative: authenticate instances with a write token](#alternative-authenticate-instances-with-a-write-token).

The read endpoint does not have this problem: the read token over HTTPS is a
proper secret. But both endpoints are served by the same host and port, so
exposing the service to download the report from outside exposes the write
endpoint with it. Either download from inside the network, or have your proxy
or firewall block `POST /api/v1/instance-reports` from the outside while
allowing `GET /api/v1/report`.

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

In order to enable the `instance-reporting` module, your n8n instance needs to be on version `2.40.6` or higher.

The airgapped instance reporting is an opt-in n8n module. On **every** n8n instance that should report, set:

```sh
N8N_ENABLED_MODULES=instance-reporting
N8N_INSTANCE_REPORTING_BASE_URL=https://airgap-monitoring.acme.com
N8N_INSTANCE_REPORTING_LABEL=<optional label that will be included in reports>
```

Notes:

- n8n authenticates with its license certificate, the value of
  `N8N_LICENSE_CERT`, which a licensed instance already has.
- `N8N_INSTANCE_REPORTING_BASE_URL` is the origin only. The n8n instance will append
  the path of the reporting endpoint itself.
- If `N8N_ENABLED_MODULES` already lists other modules, add
  `instance-reporting` to the comma-separated list rather than replacing it.
- The `insights` module must stay enabled (it is enabled by default). The daily figure comes from its data.
- The label is shown in the report to help you tell instances apart. It is
  cosmetic. The instance id stays the identity, so relabeling an instance
  never splits or merges its history.
- The label is stored URL-compliant: lowercase letters, digits and hyphens, at
  most 200 characters. The report is never rejected because of the label: other
  characters are replaced and a longer label is cut. For example,
  `Acme Prod / EU` is stored as `acme-prod-eu` and `Café Zürich` as
  `cafe-zurich`. A label with no letters or digits that
  can be kept, for example `!!!`, is stored as no label.
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
    "airgapMonitoringVersion": "0.2.1",
    "instances": [
      {
        "instanceId": "450b5c85…",
        "label": "acme-prod",
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

To download the report for some instances only, pass their ids as the
`instanceId` query parameter, comma-separated (up to 100 ids, each at most 256
characters):

```
GET <url-of-self-hosted-airgap-monitoring-service>/api/v1/report?instanceId=450b5c85…,9f1e2d3c…
```

To download the report for some days only, pass `start` and `end` as
`YYYY-MM-DD`. Daily points are matched by `date`; cumulative points are matched
by the UTC day of `receivedAt`. Both days are included, and either can be used
alone. Instances without points in those days are left out, and `firstSeen`,
`lastReportAt` and `label` still describe the full history. For example,
October 2026:

```
GET <url-of-self-hosted-airgap-monitoring-service>/api/v1/report?start=2026-10-01&end=2026-10-31
```

A filtered report has a `filters` field that lists the applied filters as a
query string (e.g. `instanceId=450b5c85…,9f1e2d3c…&start=2026-10-01&end=2026-10-31`).

Without `start` or `end` the report contains the complete history. In a future update we're adding a default threshold for the "time to look back".

## Alternative: authenticate instances with a write token

Use this only if you cannot restrict the write endpoint to your own instances
on the network level. Instead of their license certificate, instances then
present a secret write token that you generate and distribute to every
instance yourself.

1. Set `N8N_MONITORING_WRITE_TOKEN` on the service. Use a different value from
   the read token. License certificates are then no longer accepted.
2. Set `N8N_INSTANCE_REPORTING_AUTH_TOKEN` to the same value on every n8n
   instance. n8n sends it as a bearer token instead of the certificate. This
   works from n8n version `2.39.6`.

The service then needs no network restriction beyond TLS. When you rotate the
write token, every instance needs the new value too.

## Environment variable reference

### On the n8n-airgap-monitoring instance

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `N8N_MONITORING_READ_TOKEN` | yes | none | Bearer token required to download the report. The service refuses to start without it. |
| `N8N_DB_PATH` | no | `/data/database.sqlite` in the image | Location of the SQLite file. Must be on persistent storage. |
| `N8N_MONITORING_WRITE_TOKEN` | no | none | Only for the [write token alternative](#alternative-authenticate-instances-with-a-write-token). Instances must then present it as a bearer token, and license certificates are not accepted. |


Tokens are read at start-up. After rotating one, restart the service.

### On each n8n instance

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `N8N_ENABLED_MODULES` | yes | none | Must include `instance-reporting`. |
| `N8N_INSTANCE_REPORTING_BASE_URL` | yes | empty | Origin of the n8n-airgap-monitoring instance, without a path. |
| `N8N_LICENSE_CERT` | yes | empty | The instance's n8n license certificate. It is sent with every report as the credential. Already set on a licensed airgapped instance. |
| `N8N_INSTANCE_REPORTING_LABEL` | no | empty | Human-readable name shown in the report. |
| `N8N_INSTANCE_REPORTING_AUTH_TOKEN` | no | empty | Only for the [write token alternative](#alternative-authenticate-instances-with-a-write-token). The service's write token, sent as a bearer header; the certificate is then not sent. |

## Monitoring the health of n8n-airgap-monitoring

**Is the service up?** Have your uptime monitoring poll `GET /healthz`, as
described in step 1.

**Are instances actually reporting?** The report itself is the best signal.
Download it and check `lastReportAt` per instance. An instance whose
`lastReportAt` is older than about 48 hours is not reporting: check its n8n log
for error logs from the instance-reporting module. An instance you expect but do not see at all
has never reached the n8n-airgap-monitoring service, which is usually a wrong URL or a network
policy.

**Are only your instances reporting?** An `instanceId` in the report that you
cannot match to one of your n8n instances means the service is reachable by
outsiders. Check [Network exposure](#network-exposure) and close the path, then
report the situation to n8n so the foreign data can be excluded.

**Is the n8n-airgap-monitoring service rejecting reports?** It logs every request. Look
for these status codes:

| Status | Meaning |
| --- | --- |
| `201` | Report stored. |
| `401` | Missing or invalid credential. Check `N8N_LICENSE_CERT` on the instance: it must be a certificate issued by n8n. The service log carries a reason code (`PARSE_FAILED`, `INVALID_ISSUER`, `DECRYPTION_FAILED`, `SIGNATURE_INVALID`) and nothing else about the certificate. If you use a write token, every instance must set `N8N_INSTANCE_REPORTING_AUTH_TOKEN` to the same value; `Missing write token` means the instance sent none, `BAD_TOKEN` in the log means it differs. |
| `400` | Malformed report, or a field is over its limit, for example more than 1000 data points. The message names the field. Should not happen with a supported n8n version. Report it to n8n. |
| `413` | The request body is larger than 256 KiB. Should not happen with a supported n8n version. If the service log does not show the request at all, a proxy in front of the service rejected it: its body size limit must be at least 256 KiB. The limits are explained in [ADR 11](adr/2026-09-24-bound-instance-report-size.md). |
| `409` | The exact same report (same instance id and `batchId`) was sent twice. n8n instances never do this on their own, so it points to a replayed request or a cloned instance database. Nothing is stored. |

**Is the storage healthy?** Watch free space on the volume. Usage grows by about
1.5 GiB per year for 10,000 instances, so an ordinary volume alert with a
generous threshold is enough. Take a snapshot of the volume before every
upgrade, since database migrations only run forward.
