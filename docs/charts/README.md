# Helm charts

Reference Kubernetes deployment for the service in this repository.
The chart is not published to a registry yet, users may copy it into their own deployment repository.

| Chart | What it deploys |
| --- | --- |
| [airgap-monitoring](airgap-monitoring/) | The collector: one pod, one SQLite file on one persistent volume, plus the Service in front of it. An Ingress is optional and off by default; set `ingress.enabled=true` when reporting instances reach the collector from outside the cluster. The defaults are the production recommendation for a fleet of 10,000 reporting instances. |
