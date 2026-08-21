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
make up      # cluster + images + deploy + port-forwards
make status  # pod status across all namespaces
make reports # what the monitoring service has received so far
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
Note that a report covers *yesterday's* completed UTC day plus a lifetime total, so on a
freshly created instance the daily value is legitimately 0.

## Known issue: reports never arrive (n8n-side bug)

As of the n8n revision this was tested against, the instances send nothing and log
`AuthPrincipal does not have a role defined` once per interval. The demo setup is fine —
the cause is upstream, in `OwnershipService.getInstanceOwner()`
(`packages/cli/src/services/ownership.service.ts`): it filters users *by* role but does
not load the relation, so the `User` it hands to `InsightsService.getInsightsSummary()`
has no `role` and permission resolution throws. The sibling query lower in that same file
does the identical lookup with `relations: ['role']`; `getInstanceOwner()` just omits it.

Until that is fixed in the n8n checkout the image is built from, you can verify that
everything this demo owns works — cluster DNS, the internal URL, the shared token, and
the payload schema — by sending a report by hand from inside an instance:

```sh
export KUBECONFIG=$PWD/.kubeconfig
pod=$(kubectl get pod -n n8n-1 -l app=n8n -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n n8n-1 $pod -- node -e '
fetch(process.env.N8N_INSTANCE_REPORTING_WEBHOOK_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer " + process.env.N8N_INSTANCE_REPORTING_AUTH_TOKEN,
  },
  body: JSON.stringify({
    instanceId: "demo-instance-axolotl",
    label: process.env.N8N_INSTANCE_REPORTING_IDENTIFIER,
    n8nVersion: "2.99.0",
    dataPoints: [{ kind: "cumulative", name: "billableExecutionTotal", value: 42 }],
  }),
}).then(async r => console.log(r.status, await r.text()))'
```

That returns `201` and the report then shows up in `make reports`.

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
