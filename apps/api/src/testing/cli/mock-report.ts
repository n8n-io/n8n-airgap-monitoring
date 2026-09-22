// Development CLI. Prints a complete, schema-valid POST body for
// /api/v1/instance-reports, so a report can be posted without an n8n instance.
// Authenticate the request with the write token:
//
//   pnpm --filter api --silent mock-report --label demo --days 3 | \
//     curl -sS -X POST localhost:3001/api/v1/instance-reports \
//       -H 'authorization: Bearer dev-write-token' -H 'content-type: application/json' -d @-
//
// Or set N8N_LICENSE_CERT to a real n8n license certificate and the body
// carries it as `licenseCert` instead, for a receiver without a write token.
import { randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

const USAGE = `usage: mock-report [--instance-id ID] [--label LABEL] [--days N]
  --label LABEL  1-200 characters
  --days N       add N daily data points ending yesterday (default 0)
  N8N_LICENSE_CERT, when set, is embedded as licenseCert`;

const DAY_MS = 24 * 60 * 60 * 1000;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const { values } = parseArgs({
  options: {
    "instance-id": { type: "string" },
    label: { type: "string" },
    days: { type: "string", default: "0" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const days = Number(values.days);
if (!Number.isInteger(days) || days < 0) fail(`--days must be a non-negative integer\n${USAGE}`);
if (values.label !== undefined && (values.label.length < 1 || values.label.length > 200)) {
  fail(`--label must be 1-200 characters\n${USAGE}`);
}

const yesterday = Date.now() - DAY_MS;
const dailyPoints = Array.from({ length: days }, (_, offset) => ({
  kind: "daily",
  name: "billableExecutionPerDay",
  value: 1000 + Math.floor(Math.random() * 1000),
  date: new Date(yesterday - offset * DAY_MS).toISOString().slice(0, 10),
})).reverse();

const licenseCert = process.env.N8N_LICENSE_CERT;

const report = {
  // n8n derives its id as a sha256 hex digest; match the shape.
  instanceId: values["instance-id"] ?? randomBytes(32).toString("hex"),
  batchId: randomUUID(),
  ...(values.label ? { label: values.label } : {}),
  n8nVersion: "0.0.0-mock",
  dataPoints: [{ kind: "cumulative", name: "billableExecutionTotal", value: 10_000 + days * 1500 }, ...dailyPoints],
  ...(licenseCert ? { licenseCert } : {}),
};

process.stdout.write(`${JSON.stringify(report)}\n`);
