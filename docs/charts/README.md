# Helm charts

Reference Kubernetes deployment for the service in this repository.
The chart is not published to a registry yet, users may copy it into their own deployment repository.

| Chart | What it deploys |
| --- | --- |
| [airgap-monitoring](airgap-monitoring/) | The collector: one pod, one SQLite file on one persistent volume, plus the Service and Ingress around it. The defaults are the production recommendation for a fleet of 10,000 reporting instances. |
