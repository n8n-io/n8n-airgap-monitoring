# Local k8s demo

Runs the whole airgapped-monitoring story on one machine: two n8n instances and the
airgap-monitoring service in a [kind](https://kind.sigs.k8s.io/) cluster, with the
instances reporting to the service over cluster-internal DNS — no traffic leaves the
cluster, which is the point of the setup.

The monitoring service is API only. There is no UI to open; `make reports` prints what
has arrived.

## Prerequisites

- `docker`, `kind`, `kubectl`, `helm`, `python3`
- The n8n image built locally as `n8nio/n8n:local` (from an n8n checkout, e.g.
  `pnpm build:docker`). The monitoring image is built by `make up` from this repo's root
  `Dockerfile` and deployed with the customer-facing Helm chart in
  [`docs/charts/airgap-monitoring`](../../docs/charts/airgap-monitoring), so the demo
  exercises the same manifests customers get.

## Usage

```sh
make up      # cluster + images + deploy + port-forwards + demo workflow
make status  # pod status across all namespaces
make reports # what the monitoring service has received so far
make seed    # (re-)create the demo workflow on both instances
make down    # stop forwards and remove workloads, keep the cluster
make nuke    # ... and delete the cluster
```

`make up` is idempotent; re-run it after changing the monitoring service to rebuild,
reload, and restart it. The n8n pods are not restarted automatically — after rebuilding
`n8nio/n8n:local`, run `make images && kubectl rollout restart deployment/n8n -n n8n-1`.

| What | URL | Credentials |
|---|---|---|
| n8n-1 (`axolotl`) | http://localhost:3003 | `admin@n8n.io` / `hello1234` |
| n8n-2 (`narwhal`) | http://localhost:3004 | `admin@n8n.io` / `hello1234` |
| monitoring API | http://localhost:3010 | write token `demo-write-token`, read token `demo-read-token` |

The instance owner is provisioned from environment variables
(`N8N_INSTANCE_OWNER_MANAGED_BY_ENV`), so there is no setup wizard to click through.
Reporting reads its numbers as the instance owner, so having one from first boot is what
makes reports meaningful.

Each instance reports once a day, at a random UTC time chosen on first boot (never
before 03:00 UTC), to
`http://airgap-monitoring.monitoring.svc.cluster.local:3000/api/v1/instance-reports`.

## Seeing what arrived

`POST /api/v1/instance-reports` is currently the service's only route, so there is no
read endpoint to curl. `make reports` therefore reads the SQLite file inside the
monitoring pod (`kubectl exec` + `sqlite3`, both already in the image) and prints
the stored envelopes as JSON. Swap it for an HTTP request once a read endpoint exists.

## Where the numbers come from

`make up` seeds each instance with [workflows/schedule-demo.json](workflows/schedule-demo.json)
— a schedule trigger firing every 10 seconds into a Set node — so the instances produce
production executions on their own and the reports are not all zeroes. `make seed` runs
the same step on demand and skips instances that already have the workflow.

One setting exists purely to compress the demo's timescale, in the deployment template:
`N8N_INSIGHTS_COMPACTION_INTERVAL_MINUTES=1` makes insights aggregate raw execution rows
every minute rather than hourly, so the daily figure isn't stale for the first hour.

The daily report itself can't be sped up the same way — each instance picks a random UTC
time on first boot and only fires there, never before 03:00 UTC — so it may not show up
during a short demo session.

`make up` also posts `BACKFILL_DAYS` (default 3) of invented daily history to the
collector, so there is a series to look at on a cluster that is minutes old. The volumes
are randomised per instance and per day — quieter at weekends — but seeded from the
instance id and the date, so re-running reproduces the same numbers instead of
reshuffling them. `make backfill` runs it on demand and `BACKFILL_DAYS=0 make up` turns it
off.

Each backfilled day is its own report with a deterministic `batchId`
(`backfill-<instance>-<date>`), so a re-run does not stack a second row for the same day:
the collector rejects the repeat with a `409`, and the script reports it as already present
rather than failing.

Only the collector is backfilled; n8n's own insights tables are left alone. That is why
the invented days stop at the *day before yesterday* — yesterday belongs to the live
reporter, and writing both would put two rows with the same date in the store.

The two metrics behave differently, which is worth knowing before concluding something is
broken:

- `billableExecutionTotal` is a lifetime cumulative count and starts moving within a
  minute or two of seeding.
- `billableExecutionPerDay` covers **yesterday's** completed UTC day. n8n deliberately
  never reports a partial day, so on a cluster created today this reads 0 no matter how
  many executions run — it turns non-zero after the first UTC midnight. The backfilled
  days sit further back in the history.

One rough edge: n8n stamps every report with a fresh `batchId` (`randomUUID()` per send),
even when re-sending the same day, so yesterday accumulates one stored envelope per
minute — all identical. The backfilled days are unaffected, since this script uses a
deterministic `batchId` per day.

## Notes

- The cluster is named `airgap-demo` and uses an isolated kubeconfig at `.kubeconfig`, so
  it never touches `~/.kube/config` and coexists with other local clusters.
- The demo instances have no n8n license, so they authenticate with the write token
  instead of a license certificate. It is a fixed demo value defined at the top of the
  Makefile, set on the service as `N8N_MONITORING_WRITE_TOKEN` and on each instance as
  `N8N_INSTANCE_REPORTING_AUTH_TOKEN`, and the two must stay in sync. `make backfill`
  uses the same token. Both credentials are described in
  [docs/AUTHORIZATION.md](../../docs/AUTHORIZATION.md).
- Each instance keeps its `N8N_ENCRYPTION_KEY` across reinstalls (the Makefile reuses the
  existing secret), so data on the volume stays decryptable.
- Drop a `.env` file next to this README to inject extra variables into both n8n pods —
  a license activation key, for example. Variables set explicitly in the deployment
  template take precedence over it.
