/**
 * Seeds a running instance with sample usage reports over the real
 * POST /api/v1/instance-reports endpoint, so seeded data goes through the same validation
 * and business logic as production traffic instead of writing to SQLite
 * directly.
 *
 * Usage: start the app (`pnpm --filter api build && pnpm --filter api start`),
 * then in another shell:
 *   N8N_INSTANCE_AUTH_TOKEN=<token> pnpm --filter api seed
 * Optional: N8N_BASE_URL (default http://localhost:3000)
 */
import { createHash } from "node:crypto";
import type { CreateInstanceReport, Metric } from "../instance-report/instance-report.service.js";

const baseUrl = process.env.N8N_BASE_URL ?? "http://localhost:3000";
const authToken = process.env.N8N_INSTANCE_AUTH_TOKEN?.trim();

// Real instanceIds are 64-char hex, so derive a stable one per seed instance
// instead of a human-readable slug.
function instanceId(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function dailyBatch(name: string, valuesByDate: Record<string, number>): Metric[] {
  return Object.entries(valuesByDate).map(([date, value]) => ({
    kind: "daily",
    name,
    value,
    date,
    batchId: `seed-${name}-${date}`,
  }));
}

const reports: CreateInstanceReport[] = [
  {
    instanceId: instanceId("mango"),
    label: "Banana — prod",
    n8nVersion: "1.99.0",
    dataPoints: [
      { kind: "cumulative", name: "activeWorkflows", value: 87 },
      { kind: "cumulative", name: "prodExecutionsLifetime", value: 442891 },
      ...dailyBatch("prodExecutions", {
        "2026-03-23": 14210,
        "2026-03-24": 15012,
        "2026-03-25": 15234,
      }),
    ],
  },
  {
    instanceId: instanceId("papaya"),
    label: "Papaya",
    n8nVersion: "1.98.2",
    dataPoints: [
      { kind: "cumulative", name: "activeWorkflows", value: 34 },
      { kind: "cumulative", name: "successRate", value: 99.1 },
    ],
  },
  {
    instanceId: instanceId("unlabeled-durian"),
    n8nVersion: "1.95.0",
    dataPoints: [
      { kind: "cumulative", name: "successRate", value: 97.8 },
      ...dailyBatch("billableExecutions", { "2026-03-25": 512 }),
    ],
  },
];

async function seed(): Promise<void> {
  if (authToken === undefined || authToken.trim() === "") {
    console.error("N8N_INSTANCE_AUTH_TOKEN must be set to the token the target instance was started with");
    process.exitCode = 1;
    return;
  }

  for (const report of reports) {
    const res = await fetch(`${baseUrl}/api/v1/instance-reports`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(report),
    });

    if (!res.ok) {
      console.error(`Failed to seed ${report.instanceId}: ${res.status} ${await res.text()}`);
      process.exitCode = 1;
      continue;
    }

    console.log(`Seeded ${report.instanceId}`);
  }
}

void seed();
