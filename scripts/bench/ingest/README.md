# Ingest benchmark (API-350)

Sends `POST /api/v1/instance-reports` to one replica under the resources of
the [reference chart](../../../docs/charts/airgap-monitoring/README.md#sizing)
(1 CPU, 512 MiB without swap, `--max-old-space-size=384`) at a ladder of rates,
by default 100, 170, 300, 400, 500 and 600 req/s for 20 s each, and reports for
every step whether it kept up. 170 req/s, the retry burst the chart is sized
for, is the level that must always hold.

## What the load looks like

- Every request is one report as n8n sends it: a random instance out of 10,000,
  a fresh `batchId`, a cumulative and a daily `billableExecutions` data point,
  and a license certificate the size of a real one (~7.3 KB). Certificate auth
  is what n8n uses in production, and the server verifies it on every request.
- Each step is a k6 `constant-arrival-rate` scenario: requests start at the
  step's rate whether or not earlier ones have finished. When the server falls
  behind, k6 drops iterations, which the report counts.
- A step is held if every request finished with a 201, none was dropped and
  p99 stays at or below 500 ms. The report names the highest step held before
  the first miss.

Known gaps against production: requests arrive evenly spaced rather than at
random moments, k6 reuses keep-alive connections where real instances open one
each, and the database starts empty instead of holding years of reports. All
three make the numbers somewhat optimistic.

## Run it locally

Needs Docker with Compose and [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/).

```sh
docker compose -f scripts/bench/ingest/compose.yml up -d --build --wait --renew-anon-volumes
k6 run scripts/bench/ingest/ingest.k6.js
docker compose -f scripts/bench/ingest/compose.yml down -v
```

Other rates and step lengths: `k6 run -e STEPS=170,1000,1500 -e STEP_SECONDS=30 ...`.

## Run it on a PR

Run the **Benchmark Ingest** workflow with `ref` set to the PR branch (or
`refs/pull/<n>/head`). The job summary has the per-step table; the run never
fails on it. A full ladder takes about three minutes.

## The mock license

`license-cert.txt` is signed by the mock CA in `compose.yml`, whose private key
was thrown away. The image trusts that CA only under `NODE_ENV=test`, so the
certificate is worthless anywhere else. If every request gets a `401`, replace
both with a new pair from `generateMockCa` and `buildContainer` in
`apps/api/src/test-utils/mock-license.ts`.
