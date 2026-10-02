# airgap-monitoring Helm chart

The n8n-recommended way to run the airgap-monitoring collector on Kubernetes.
The defaults are the production recommendation for a fleet of up to 10,000
self-hosted n8n instances, each posting one usage report per day. The chart is
cloud-agnostic; the places where providers differ (storage class, ingress
controller, image registry) are plain values.

## What the chart deploys

| Resource | Default | Notes |
| --- | --- | --- |
| Deployment | 1 replica, `strategy: Recreate` | Fixed. SQLite on a ReadWriteOnce volume has exactly one writer. |
| PersistentVolumeClaim | 10Gi, RWO, cluster default StorageClass, kept on uninstall | Holds the SQLite database, the only copy of the fleet's usage history. |
| Service | ClusterIP on port 3000 | In-cluster URL for reporting instances and for report downloads. Reachable only inside the cluster. |
| Ingress | Disabled | For instances that report from outside the cluster. Must stay off the public internet, see [Network exposure](#network-exposure). |

## Prerequisites

- Kubernetes 1.25 or newer, Helm 3.12 or newer.
- A StorageClass backed by SSD that supports `ReadWriteOnce`.
- The image `ghcr.io/n8n-io/n8n-airgap-monitoring:<version>` mirrored into a
  registry your cluster can reach. Pin the exact version; `latest` and
  `stable` move.
- A Secret in the release namespace holding the read token, and optionally a
  write token. The write token decides how instances authenticate, see the
  next two points.
- Either a write token distributed to every reporting n8n instance
  (`N8N_INSTANCE_REPORTING_AUTH_TOKEN`), or, without one, instances that hold
  an n8n license certificate (`N8N_LICENSE_CERT`).
- Without a write token, a network in which only your own n8n instances can
  reach the service's data ingestion endpoint. See
  [Network exposure](#network-exposure).

## Install

1. Mirror the image, keeping the tag:

   ```sh
   VERSION=<latest-release>   # the chart's appVersion in Chart.yaml
   docker pull ghcr.io/n8n-io/n8n-airgap-monitoring:$VERSION
   docker tag  ghcr.io/n8n-io/n8n-airgap-monitoring:$VERSION registry.example.internal/n8n/n8n-airgap-monitoring:$VERSION
   docker push registry.example.internal/n8n/n8n-airgap-monitoring:$VERSION
   ```

2. Create the token Secret with your usual secrets tooling. The read token is
   required: it unlocks the fleet report and must never reach an n8n instance.
   The write token is optional and picks the mode: with it, every instance
   must present it and license certificates are not accepted, which makes the
   ingest endpoint safe to expose over TLS; without it, instances authenticate
   with their license certificate and you must restrict the network instead.
   Use a different value from the read token. Shown with `kubectl` for
   brevity:

   ```sh
   kubectl create namespace airgap-monitoring
   kubectl -n airgap-monitoring create secret generic airgap-monitoring-tokens \
     --from-literal=N8N_MONITORING_READ_TOKEN="$(openssl rand -hex 32)" \
     --from-literal=N8N_MONITORING_WRITE_TOKEN="$(openssl rand -hex 32)"   # optional
   ```

3. Install from a checkout of this repository:

   ```sh
   helm install airgap-monitoring docs/charts/airgap-monitoring \
     --namespace airgap-monitoring \
     --set image.repository=registry.example.internal/n8n/n8n-airgap-monitoring \
     --set auth.existingSecret=airgap-monitoring-tokens \
     --set persistence.storageClassName=<your ssd class>
   ```

   The printed release notes contain the URL to configure on the n8n side.

4. Configure every reporting n8n instance:

   ```sh
   N8N_ENABLED_MODULES=instance-reporting
   N8N_INSTANCE_REPORTING_BASE_URL=http://airgap-monitoring.airgap-monitoring.svc.cluster.local:3000
   N8N_INSTANCE_REPORTING_LABEL=<optional human-readable name>
   ```

   If you created a write token, add `N8N_INSTANCE_REPORTING_AUTH_TOKEN=<write token>`
   on every instance. Without one, the instance authenticates with its license
   certificate (`N8N_LICENSE_CERT`), which a licensed airgapped instance already
   has, and nothing else is needed. Both modes are described in
   [AUTHORIZATION.md](../../AUTHORIZATION.md#create-instance-report-route).

   Instances outside the cluster need an Ingress (`ingress.*`) and use its
   hostname instead. Read [Network exposure](#network-exposure) before enabling
   it. Terminate TLS on it: each report carries the instance's license
   certificate and the report download carries the read token, so the chart
   refuses to render an Ingress without `ingress.tls` unless you set
   `ingress.allowInsecureHttp=true` because TLS terminates further upstream.
   Make sure the ingress controller does not log request bodies.

## Network exposure

This section applies when the Secret holds no write token, so that instances
authenticate with their license certificate. With a write token, only holders
of your token can write, and the ingest endpoint needs no network restriction
beyond TLS.

> **Warning:** Without a write token, the write endpoint,
> `POST /api/v1/instance-reports`, must only be reachable from your own n8n
> instances. Never expose it to the public internet. Enforce this on the
> network level.

In that mode the endpoint accepts any valid n8n license certificate, and every
n8n customer holds one. The service cannot tell your instances from someone
else's, so an internet-reachable service lets anyone with an n8n license write
into your database. If you cannot guarantee the restriction, set a write token
instead.

The chart's defaults are already private: a ClusterIP Service and no Ingress.
Instances inside the cluster need nothing more. The chart ships no
NetworkPolicy, because every environment enforces network boundaries in its
own way; use whatever you already use for internal services.

For instances outside the cluster, enable the Ingress and make sure that
`POST /api/v1/instance-reports` is reachable by your n8n instances and by
nothing else. How you achieve that is up to your environment, for example
with a private network or a source allowlist on the proxy, but any mechanism
that gives the same guarantee is fine. The chart takes no position on it.

The ingress controller must accept request bodies of at least 256 KiB, the
limit of the service itself. The default of the Kubernetes nginx ingress is
1 MiB, so it needs no change.

The read endpoint, `GET /api/v1/report`, is a different case. Its token over
TLS is enough protection, so it could be reachable from outside. But it runs
on the same service as the write endpoint. Opening the service to the internet
so that you can download the report also opens the write endpoint. Either
download from inside the network, or make sure that only `GET /api/v1/report`
is reachable from outside.

## Sizing

The defaults come from the service's measured behaviour and this load model:

| | |
| --- | --- |
| Instances | 10,000, one report per day each, at a fixed random time per instance |
| Write path | One ~1 KB `INSERT`, fsynced before the `201` is returned |
| Worst case | A retry burst after an outage: up to ~170 reports/second for a minute, which needs under 6 ms per commit on the volume |
| Report download | A few times a day, streamed one instance at a time |

### Compute

| Setting | Default | Why |
| --- | --- | --- |
| CPU request | `100m` | Idle nearly all day. |
| CPU limit | `1` | Streaming the fleet report is CPU-bound JSON work. A limit throttles rather than reserves, so a full core costs nothing while idle. |
| Memory request | `256Mi` | Roughly what the pod uses during a download, which keeps it out of eviction under node memory pressure. |
| Memory limit | `512Mi` | Peak memory tracks the largest single instance's history, not the fleet size, because the report is streamed. |
| `NODE_OPTIONS` | `--max-old-space-size=384` | Caps the V8 heap at 75% of the limit so garbage collection runs before the kernel OOM-kills the pod. Keep the ratio if you change the limit. |

### Storage

| Setting | Default | Why |
| --- | --- | --- |
| Size | `10Gi` | About 400 bytes per stored report, so 10,000 instances add roughly 1.5 GiB per year. Grow it rather than start big. |
| StorageClass | Cluster default | Pick an SSD-backed class. Fsync latency matters, not IOPS or capacity. |

Starting points by provider: `gp3` on AWS, `managed-csi-premium` on Azure,
`premium-rwo` on GCP, any SSD-backed CSI class on-premises. Avoid NFS and
other network file systems for SQLite.

## Availability and backups

The service runs as a single pod on purpose: SQLite on one RWO volume cannot
have two writers, so a second replica or an HPA would add nothing. Upgrades and
restarts take a few seconds, and reporting instances that hit the gap retry the
same report later. A node failure reschedules the pod wherever the volume can
attach.

Every accepted report is fsynced, so a block-level snapshot of the volume is
always a consistent backup. Take one before every upgrade, because schema
migrations run forward only and `helm rollback` does not undo them, and include
the volume in whatever backup schedule you apply to stateful workloads. To
restore, create a PVC from the snapshot and install with
`persistence.existingClaim`.

`helm uninstall` keeps the PVC. Delete it by hand when you really mean it.

## Token rotation

The service reads its tokens at start-up, so after changing the Secret restart
the Deployment. Instances that authenticate with their license certificate are
unaffected. Instances that use the write token need the new value too; until
they have it they get `401` responses and retry later, so nothing is lost.

## Values

The ones you will need. Everything else is documented in
[values.yaml](values.yaml).

| Value | Default | Description |
| --- | --- | --- |
| `image.repository` | `ghcr.io/n8n-io/n8n-airgap-monitoring` | Your mirror. |
| `image.tag` | chart `appVersion` | Pin an exact release. |
| `imagePullSecrets` | `[]` | For a private mirror. |
| `auth.existingSecret` | `""` | **Required.** Secret holding the read token and, optionally, the write token. |
| `auth.readTokenKey` / `auth.writeTokenKey` | `N8N_MONITORING_READ_TOKEN` / `N8N_MONITORING_WRITE_TOKEN` | Keys in that Secret. A present write-token key puts the service in token mode; an absent one in certificate mode. |
| `persistence.storageClassName` | cluster default | An SSD-backed class. |
| `persistence.size` | `10Gi` | |
| `persistence.existingClaim` | `""` | Reuse a PVC, for example one restored from a snapshot. |
| `service.type` | `ClusterIP` | Leave at the default. `LoadBalancer` or `NodePort` would make the ingest endpoint reachable from outside the cluster, which without a write token bypasses the safeguards in [Network exposure](#network-exposure). |
| `ingress.*` | disabled | Standard `className`, `annotations`, `hosts`, `tls`. `tls` is required when enabled unless `allowInsecureHttp=true`. Without a write token, keep the host private, see [Network exposure](#network-exposure). |
| `resources` | see [Compute](#compute) | |
