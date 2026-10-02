# Ingest benchmark (API-350)

Sends `POST /api/v1/instance-reports` to one replica under the resources of
the [reference chart](../../../docs/charts/airgap-monitoring/README.md#sizing)
(1 CPU, 512 MiB without swap, `--max-old-space-size=384`) at a ladder of rates,
by default 100, 170, 300, 400, 500 and 600 req/s for 20 s each, and reports for
every step whether it kept up. The run fails only when the 170 req/s step is
not held; the rest of the ladder is a report.

## What the load looks like

- Every request is one report as n8n sends it: a random instance out of 10,000,
  a fresh `batchId`, a cumulative and a daily `billableExecutions` data point,
  and a license certificate the size of a real one (~7.3 KB). Certificate auth
  is what n8n uses in production, and the server verifies it on every request.
- Each step is a k6 `constant-arrival-rate` scenario: requests start at the
  step's rate whether or not earlier ones have finished. When the server falls
  behind, k6 drops iterations, which the report counts.
- Each request waits a random 0–1 s after its scheduled start, so requests land
  at random moments, like reports from 10,000 instances, instead of evenly
  spaced. The wait is not part of the measured latency.
- A step is held if every request got a 201 within 30 s, none was dropped and
  p99 stays at or below 1 s. The report names the highest step held before the
  first miss and its headroom over 170 req/s.

## Why these numbers

| | | |
| --- | --- | --- |
| Required rate | 170 req/s | The worst case the [chart is sized for](../../../docs/charts/airgap-monitoring/README.md#sizing): all 10,000 instances retrying within one minute after an outage (10,000 / 60 s). |
| Request timeout | 30 s | What n8n waits before it gives up on a request and retries 5 min later, 3 attempts in all (`REQUEST_TIMEOUT_MS` in n8n's [`instance-reporting.service.ts`](https://github.com/n8n-io/n8n/blob/fa30358f84dc6a9eec3e01f4699918eca7894856/packages/cli/src/modules/instance-reporting.ee/instance-reporting.service.ts#L27)). |
| p99 | ≤ 1 s | Keeps the slowest 1% of requests 30 times inside that timeout. |
| Steps | 100–600 req/s | 100 warms the server up; 300–600 bracket the limit on the `ubuntu-24.04` runner, about 400–500 req/s. |

Known gaps against production: k6 reuses keep-alive connections where real
instances open one each, and the database starts empty instead of holding years
of reports. Both make the numbers somewhat optimistic.

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
`refs/pull/<n>/head`). The job summary has the per-step table. A full ladder
takes about five and a half minutes.

A hosted runner is now and then slow on its own, enough to miss even 100 req/s.
If the run fails, run it again: a real regression fails twice in a row.

## The mock license

`license-cert.txt` is signed by the mock CA in `compose.yml`, whose private key
was thrown away. The image trusts that CA only under `NODE_ENV=test`, so the
certificate is worthless anywhere else. If every request gets a `401`, replace
both with a new pair from `generateMockCa` and `buildContainer` in
`apps/api/src/test-utils/mock-license.ts`.
