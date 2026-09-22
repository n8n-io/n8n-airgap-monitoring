# n8n Airgap Monitoring

A central monitoring service for a fleet of n8n instances in an airgapped environment.
Many self-hosted n8n instances report usage metrics daily to one n8n-airgap-monitoring instance.
See the counterpart module in the n8n repository here: [n8n-io/n8n/instance-reporting](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/modules/instance-reporting.ee/README.md)

Sequence diagrams of both flows, reporting and downloading, are in
[docs/DIAGRAMS.md](docs/DIAGRAMS.md). Design decisions are recorded as ADRs in
[docs/adr/](docs/adr/).

See also the user guide at [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `N8N_MONITORING_READ_TOKEN` | yes | — | Bearer token required to download the usage report from `GET /api/v1/report`. The service refuses to start without it. |
| `N8N_MONITORING_WRITE_TOKEN` | no | — | Selects the authentication mode of `POST /api/v1/instance-reports`. Set: instances must present it as a bearer token and license certificates are not accepted. Unset: instances authenticate with their license certificate. |
| `N8N_DB_PATH` | no | `./data/database.sqlite` | SQLite file holding the usage events. Point this at a mounted volume so reports survive container restarts. |

A reporting n8n instance authenticates with its n8n license certificate, or,
if you set a write token, with that token alone. See
[Reporting usage](#reporting-usage) and
[docs/AUTHORIZATION.md](docs/AUTHORIZATION.md).

## Reporting usage

Each n8n instance sets `N8N_INSTANCE_REPORTING_BASE_URL` to this service's base
URL (the instance appends `/api/v1/instance-reports` itself), then sends one
report per day. The report carries the instance's license certificate in
`licenseCert`, the same string the instance holds in `N8N_LICENSE_CERT`:

```http
POST /api/v1/instance-reports
Content-Type: application/json

{
  "instanceId": "450b5c8502c2a390dba93257bde5fe7eb39397d43d8b307e8626f9d84b19e4d2",
  "batchId": "917fbe09-1fb0-4d5b-868d-d0536237638d",
  "label": "prod",
  "n8nVersion": "1.99.0",
  "dataPoints": [
    { "kind": "cumulative", "name": "billableExecutions", "value": 87 },
    {
      "kind": "daily",
      "name": "billableExecutions",
      "value": 15234,
      "date": "2026-03-25"
    }
  ],
  "licenseCert": "<base64 n8n license certificate>"
}
```

`licenseCert` is the credential. The service checks that the certificate chains
to the n8n license CA and that its payload signature verifies, then drops it:
nothing from the certificate is read, stored or exported, and expiry is not
checked, so an instance whose license has run out still reports. Possession of
a certificate n8n issued is the whole check. It travels in the body rather than
a header because a real certificate is about 7 KB and sits too close to the
8 KB per-header limit of common reverse proxies. See
[adr/2026-09-21-authenticate-with-license-certificate.md](docs/adr/2026-09-21-authenticate-with-license-certificate.md).

That is certificate mode, the default. If `N8N_MONITORING_WRITE_TOKEN` is set
on the service, it runs in token mode instead: every instance must send that
token as `Authorization: Bearer <token>` (set
`N8N_INSTANCE_REPORTING_AUTH_TOKEN` on the instance), `licenseCert` is left
out, and a certificate is not accepted as a credential. Both modes are
described in
[docs/AUTHORIZATION.md](docs/AUTHORIZATION.md#create-instance-report-route).

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

Responses are `201` with the stored event id, `401` for a missing or invalid
credential, and `400` for a malformed report. Authentication runs
before validation, so an unauthenticated caller learns nothing about the
schema. Every report is appended as its own
event rather than overwriting the previous one, so usage history stays
auditable; a reporting UI would read the newest event per instance.

## Downloading the report

A customer downloads a JSON report of everything the service has recorded and
shares it with n8n:

```http
GET /api/v1/report
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
        "firstSeen": "2026-03-20T02:00:00.000Z",
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

`dataPoints` here is a map keyed by metric name. Each key holds every
value that instance reported for that metric, oldest-first, tagged with the
`batchId` and `receivedAt` of the report that carried it.

## Deployment

[`docs/charts/airgap-monitoring/`](docs/charts/airgap-monitoring/) is the
recommended Helm chart for running the service in production: one pod, one
persistent volume, hardened defaults, sized for 10,000 reporting instances. See
[README](docs/charts/airgap-monitoring/README.md) for more detail.

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

### `pnpm --filter api mock-report`

Prints a schema-valid report body for posting without an n8n instance. See
[Local development](#local-development).

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

`N8N_MONITORING_READ_TOKEN` is deliberately **not** set. The service refuses to
boot without it, so you must supply it. `N8N_MONITORING_WRITE_TOKEN` is
optional, see [Configuration](#configuration).

### Running the image locally

`docker compose up --build` builds the image and starts it on
[http://localhost:3001](http://localhost:3001) with throwaway read and write
tokens and a named volume:

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

The compose file sets a write token, so the service runs in token mode and a
report needs that token as a bearer header. See
[Local development](#local-development).

### Local development

The service runs in token mode when `N8N_MONITORING_WRITE_TOKEN` is set and in
certificate mode otherwise, so there are two ways to exercise it locally:

- **Without an n8n instance.** Post bodies from `mock-report` with the write
  token. Against compose:

  ```sh
  pnpm --filter api --silent mock-report --label demo --days 3 | \
    curl -sS -X POST localhost:3001/api/v1/instance-reports \
      -H 'authorization: Bearer dev-write-token' -H 'content-type: application/json' -d @-
  ```

  Against `pnpm dev`, start it with `N8N_MONITORING_READ_TOKEN` and
  `N8N_MONITORING_WRITE_TOKEN` set and post to port 3456 the same way. The
  [Kubernetes demo](#local-kubernetes-demo) and its backfill script use the
  write token too.
- **With a licensed n8n instance.** Start the receiver without a write token,
  point the instance at it via `N8N_INSTANCE_REPORTING_BASE_URL` and set
  nothing else; the instance brings its certificate. `mock-report` embeds a
  certificate from `N8N_LICENSE_CERT` when that variable is set, for posting
  by hand in certificate mode.

## Local Kubernetes demo

[`scripts/local-k8s-demo/`](scripts/local-k8s-demo/) runs two n8n instances and
this service in a [kind](https://kind.sigs.k8s.io/) cluster, with the instances
reporting over cluster-internal DNS so no traffic leaves the cluster. See its
[README](scripts/local-k8s-demo/README.md).

## License

This project is licensed under the [n8n Enterprise License](LICENSE_EE.md). See
[LICENSE.md](LICENSE.md) for details.

