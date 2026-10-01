// POST /api/v1/instance-reports at a ladder of constant arrival rates (API-350).
// See README.md.
//
//   k6 run scripts/bench/ingest/ingest.k6.js
//   k6 run -e STEPS=170,600 -e STEP_SECONDS=60 scripts/bench/ingest/ingest.k6.js

import { check } from "k6";
import exec from "k6/execution";
import http from "k6/http";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3999";
// 10k instances retrying within one minute after an outage, the worst case
// the chart is sized for (docs/charts/airgap-monitoring/README.md#sizing).
// Always run: the only step that fails the run.
const REQUIRED_RPS = 170;
const STEPS = [...new Set([REQUIRED_RPS, ...(__ENV.STEPS || "100,170,300,400,500,600").split(",").map(Number)])].sort(
  (a, b) => a - b,
);
const STEP_SECONDS = Number(__ENV.STEP_SECONDS || 20);
// n8n gives up on a request after 30 s and retries it 5 min later, 3 attempts
// in all (REQUEST_TIMEOUT_MS in packages/cli/src/modules/instance-reporting.ee/
// instance-reporting.service.ts). A slower request counts as failed here too.
const CLIENT_TIMEOUT = "30s";
// Keeps the slowest 1% 30 times inside that timeout.
const SLO_P99_MS = 1000;
// A request still running when gracefulStop cuts a step leaves no sample at
// all, so a short count is the only trace of it.
const MIN_SENT_RATIO = 0.99;
const INSTANCES = 10_000;
// Lets a step's slow requests finish before the next one starts.
const PAUSE_SECONDS = 10;

// Signed by the mock CA in compose.yml. The server caches nothing between
// requests, so one certificate costs it the same as 10k distinct ones.
const licenseCert = open("./license-cert.txt").trim();
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const run = Date.now().toString(36);

const scenario = (rps) => `rps_${rps}`;

export const options = {
  // Arrivals do not wait for responses, like 10k instances each reporting at
  // its own time. When the server falls behind, k6 runs out of VUs and drops
  // iterations instead of slowing down.
  scenarios: Object.fromEntries(
    STEPS.map((rps, i) => [
      scenario(rps),
      {
        executor: "constant-arrival-rate",
        rate: rps,
        timeUnit: "1s",
        duration: `${STEP_SECONDS}s`,
        startTime: `${i * (STEP_SECONDS + PAUSE_SECONDS)}s`,
        gracefulStop: `${PAUSE_SECONDS}s`,
        // All up front: VUs started mid-step are slow to come up and drop
        // iterations the server never saw.
        preAllocatedVUs: 1000,
        maxVUs: 1000,
      },
    ]),
  ),
  // The required step's thresholds are real. Every other step's always pass;
  // they only make the summary carry per-step metrics.
  thresholds: Object.fromEntries(
    STEPS.flatMap((rps) => {
      const real = rps === REQUIRED_RPS;
      return [
        [`http_req_duration{scenario:${scenario(rps)}}`, [real ? `p(99)<=${SLO_P99_MS}` : "max>=0"]],
        [
          `http_reqs{scenario:${scenario(rps)}}`,
          [`count>=${real ? Math.floor(MIN_SENT_RATIO * rps * STEP_SECONDS) : 0}`],
        ],
        [`checks{scenario:${scenario(rps)}}`, [real ? "rate==1" : "rate>=0"]],
        [`dropped_iterations{scenario:${scenario(rps)}}`, [real ? "count==0" : "count>=0"]],
      ];
    }),
  ),
  summaryTrendStats: ["med", "p(90)", "p(99)", "max"],
};

export default function () {
  const i = Math.floor(Math.random() * INSTANCES);
  const volume = 4_000 + Math.floor(Math.random() * 7_000);
  const res = http.post(
    `${BASE_URL}/api/v1/instance-reports`,
    JSON.stringify({
      // Shaped like n8n's sha256 hex instance ids.
      instanceId: i.toString(16).padStart(64, "0"),
      batchId: `${run}-${exec.scenario.name}-${exec.scenario.iterationInTest}`,
      label: `instance-${i}`,
      n8nVersion: "1.99.0",
      dataPoints: [
        { kind: "cumulative", name: "billableExecutions", value: 1_000_000 + volume },
        { kind: "daily", name: "billableExecutions", value: volume, date: yesterday },
      ],
      licenseCert,
    }),
    { headers: { "content-type": "application/json" }, timeout: CLIENT_TIMEOUT },
  );
  check(res, { "status is 201": (r) => r.status === 201 });
}

export function handleSummary(data) {
  const values = (name, rps) => data.metrics[`${name}{scenario:${scenario(rps)}}`]?.values ?? {};
  const ms = (value) => `${Math.round(value ?? 0)} ms`;

  const steps = STEPS.map((rps) => {
    const duration = values("http_req_duration", rps);
    const non201 = values("checks", rps).fails ?? 0;
    const dropped = values("dropped_iterations", rps).count ?? 0;
    const p99 = duration["p(99)"] ?? Number.POSITIVE_INFINITY;
    const sent = values("http_reqs", rps).count ?? 0;
    return {
      rps,
      sent,
      non201,
      dropped,
      p50: duration.med,
      p99,
      held: non201 === 0 && dropped === 0 && sent >= MIN_SENT_RATIO * rps * STEP_SECONDS && p99 <= SLO_P99_MS,
    };
  });

  const firstMiss = steps.findIndex((s) => !s.held);
  const highest = firstMiss === -1 ? steps.at(-1) : steps[firstMiss - 1];
  const required = steps.find((s) => s.rps === REQUIRED_RPS);

  const lines = [
    "### Ingest benchmark: `POST /api/v1/instance-reports`",
    "",
    `${INSTANCES} instances, certificate auth, 1 CPU / 512 MiB, ${STEP_SECONDS} s per step. ` +
      `A step is held when every request got a 201 within ${CLIENT_TIMEOUT}, none was dropped and p99 ≤ ${SLO_P99_MS} ms.`,
    "",
    `- Required ${REQUIRED_RPS} req/s: ${required.held ? "✅ held" : "❌ not held, the run fails"}`,
    `- Highest held: ${highest ? `${highest.rps} req/s${firstMiss === -1 ? " (top step, the limit is above)" : ""}` : "none"}`,
    `- Headroom over ${REQUIRED_RPS} req/s: ${highest ? `${(highest.rps / REQUIRED_RPS).toFixed(1)}×` : "none"}`,
    "",
    "| req/s | sent | non-201 | dropped | p50 | p99 | |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | :---: |",
    ...steps.map(
      (s) =>
        `| ${s.rps} | ${s.sent} | ${s.non201} | ${s.dropped} | ${ms(s.p50)} | ${ms(s.p99)} | ${s.held ? "✅" : "❌"} |`,
    ),
    "",
  ];

  const markdown = lines.join("\n");
  return __ENV.SUMMARY ? { stdout: `\n${markdown}\n`, [__ENV.SUMMARY]: markdown } : { stdout: `\n${markdown}\n` };
}
