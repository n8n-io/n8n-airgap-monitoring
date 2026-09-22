// Development CLI. Prints a complete, schema-valid POST body for
// /api/v1/instance-reports, so a report can be posted without an n8n instance:
//
//   pnpm --filter api mock-report --ca .dev-ca | curl -sS -X POST localhost:3001/api/v1/instance-reports \
//     -H 'content-type: application/json' -d @-
//
// The certificate comes from --ca DIR (a dev CA written by `mock-license ca`,
// accepted only by a receiver in test mode) or from N8N_LICENSE_CERT (a real
// one, accepted by any receiver).
import { randomBytes, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { readDevCa } from "../dev-ca.ts";
import { generateMockLicense } from "../mock-license.ts";

const USAGE = `usage: mock-report [--ca DIR] [--instance-id ID] [--label LABEL] [--days N] [--expired]
  --ca DIR       mint the certificate from the dev CA in DIR; otherwise N8N_LICENSE_CERT is used
  --label LABEL  1-200 characters
  --days N       add N daily data points ending yesterday (default 0)
  --expired      mint an expired certificate (with --ca only)`;

const DAY_MS = 24 * 60 * 60 * 1000;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const { values } = parseArgs({
  options: {
    ca: { type: "string" },
    "instance-id": { type: "string" },
    label: { type: "string" },
    days: { type: "string", default: "0" },
    expired: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const days = Number(values.days);
if (!Number.isInteger(days) || days < 0) fail(`--days must be a non-negative integer\n${USAGE}`);
if (values.expired && !values.ca) fail(`--expired needs --ca\n${USAGE}`);
if (values.label !== undefined && (values.label.length < 1 || values.label.length > 200)) {
  fail(`--label must be 1-200 characters\n${USAGE}`);
}

let licenseCert: string;
if (values.ca) {
  licenseCert = generateMockLicense({ ca: readDevCa(values.ca), expired: values.expired });
} else if (process.env.N8N_LICENSE_CERT) {
  licenseCert = process.env.N8N_LICENSE_CERT;
} else {
  fail(`no certificate: pass --ca DIR or set N8N_LICENSE_CERT\n${USAGE}`);
}

const yesterday = Date.now() - DAY_MS;
const dailyPoints = Array.from({ length: days }, (_, offset) => ({
  kind: "daily",
  name: "billableExecutionPerDay",
  value: 1000 + Math.floor(Math.random() * 1000),
  date: new Date(yesterday - offset * DAY_MS).toISOString().slice(0, 10),
})).reverse();

const report = {
  // n8n derives its id as a sha256 hex digest; match the shape.
  instanceId: values["instance-id"] ?? randomBytes(32).toString("hex"),
  batchId: randomUUID(),
  ...(values.label ? { label: values.label } : {}),
  n8nVersion: "0.0.0-mock",
  dataPoints: [{ kind: "cumulative", name: "billableExecutionTotal", value: 10_000 + days * 1500 }, ...dailyPoints],
  licenseCert,
};

process.stdout.write(`${JSON.stringify(report)}\n`);
