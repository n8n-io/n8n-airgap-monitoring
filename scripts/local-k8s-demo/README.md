# Local k8s demo

Runs the whole airgapped-monitoring story on one machine: two n8n instances and the
airgap-monitoring service in a [kind](https://kind.sigs.k8s.io/) cluster, with the
instances reporting to the service over cluster-internal DNS — no traffic leaves the
cluster, which is the point of the setup.

## Prerequisites

- `docker`, `kind`, `kubectl`, `curl`
- The n8n image built locally as `n8nio/n8n:local` (from an n8n checkout, e.g.
  `pnpm build:docker`). The monitoring image is built by `make up` from this repo's root
  `Dockerfile`.

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
| monitoring dashboard | http://localhost:3010 | token `demo-dashboard-token` |

The instance owner is provisioned from environment variables
(`N8N_INSTANCE_OWNER_MANAGED_BY_ENV`), so there is no setup wizard to click through.
Reporting reads its numbers as the instance owner, so having one from first boot is what
makes reports meaningful.

Reports are sent every minute (`REPORT_INTERVAL_MINUTES` in the Makefile) to
`http://airgap-monitoring.monitoring.svc.cluster.local:3000/api/v1/instance-reports`.
The first one lands one interval after an instance boots — n8n does not send on startup.

## Where the numbers come from

`make up` seeds each instance with [workflows/schedule-demo.json](workflows/schedule-demo.json)
— a schedule trigger firing every 10 seconds into a Set node — so the instances produce
production executions on their own and the reports are not all zeroes. `make seed` runs
the same step on demand and skips instances that already have the workflow.

Two settings exist purely to compress the demo's timescale, both in the deployment
template: reports go out every minute instead of every 60, and
`N8N_INSIGHTS_COMPACTION_INTERVAL_MINUTES=1` makes insights aggregate raw execution rows
every minute rather than hourly. Without the second one the daily figure would lag behind
by up to an hour.

The two metrics behave differently, which is worth knowing before concluding something is
broken:

- `billableExecutionTotal` is a lifetime cumulative count and starts moving within a
  minute or two of seeding.
- `billableExecutionPerDay` covers **yesterday's** completed UTC day. n8n deliberately
  never reports a partial day, so on a cluster created today this reads 0 no matter how
  many executions run — it turns non-zero after the first UTC midnight.

## Notes

- The cluster is named `airgap-demo` and uses an isolated kubeconfig at `.kubeconfig`, so
  it never touches `~/.kube/config` and coexists with other local clusters.
- Tokens are fixed demo values defined at the top of the Makefile. `INSTANCE_TOKEN` is
  shared by both sides of the reporting handshake and must stay in sync.
- Each instance keeps its `N8N_ENCRYPTION_KEY` across reinstalls (the Makefile reuses the
  existing secret), so data on the volume stays decryptable.
- Drop a `.env` file next to this README to inject extra variables into both n8n pods —
  a license activation key, for example. Variables set explicitly in the deployment
  template take precedence over it.
