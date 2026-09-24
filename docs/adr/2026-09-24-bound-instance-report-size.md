# 11. Bound the size of an instance report

> _This ADR was written by AI and reviewed by a human._

Date: 2026-09-24

Status: Active

Source: [API-211](https://linear.app/n8n/issue/API-211/add-payload-size-limit-for-sending-instance-report)

## Context

`POST /api/v1/instance-reports` had no size limits of its own. `instanceId`, `batchId`, `n8nVersion` and the metric `name` had no `maxLength`, and `dataPoints` had no `maxItems`. Fastify's default 1 MiB `bodyLimit` was the only limit. Storage is append-only (`adr/2026-08-26-report-envelopes-are-immutable.md`), so each accepted request stays on the volume that holds the billing record.

A limit that is too tight is more dangerous than a limit that is too loose. The n8n client retries a rejected report 3 times and then skips it. The next day's report covers the missed days again, up to 30 days. Thus a report that is too large stays too large, and each day the oldest day drops out of the window permanently. The receiver shows only an old `lastReportAt`.

Today a report has 1 metric. After 30 days offline, it has 30 daily points and 1 cumulative point, approx. 2.6 KB. More metrics will come. A real license certificate is 7,334 bytes (ADR 10).

## Decision

We bound each field in the schema and set a route `bodyLimit` of 256 KiB (262,144 bytes). The two follow one rule:

**`bodyLimit` = the largest report that passes the schema, serialized with `JSON.stringify` + a budget for the license certificate.**

- The largest schema-valid report is 183,960 bytes, with keys and JSON syntax. We round it up to 180 KiB.
- The rest, 76 KiB, is the certificate budget: approx. 10 times the real size of 7,334 bytes.

The budget is a limit only when a report is at every schema limit at once. A real report after 30 days offline is approx. 2.6 KB, so with a real report the certificate can grow to approx. 250 KB before the report gets 413.

| Limit | Value | Reason |
|---|---|---|
| `bodyLimit` | 256 KiB | 180 KiB for the largest schema-valid report + 76 KiB for the certificate |
| `dataPoints.maxItems` | 1000 | Approx. 30 metrics × (30 daily + 1 cumulative) |
| `name.maxLength` | 100 | Today: `billableExecutions`, 18 characters |
| `name.pattern` | `^[A-Za-z0-9_.-]+$` | `maxLength` counts characters, `bodyLimit` counts bytes. With ASCII only, 100 characters are 100 bytes. Without the pattern, `JSON.stringify` writes a control character as a 6-byte escape, and 1000 points no longer fit |
| `instanceId.maxLength` | 256 | The default is a sha256 hex digest (64 characters), but n8n does not validate `N8N_INSTANCE_ID` |
| `batchId.maxLength` | 128 | n8n sends a UUID. The format is not pinned |
| `n8nVersion.maxLength` | 64 | Semver with an optional pre-release |

Fastify checks `bodyLimit` while it reads the body, before the auth hook and before schema validation. Thus the order of errors is 413, 401, 400:

- 413 means that the body is too large. A supported n8n instance does not send such a body.
- 400 means that a specific schema limit is exceeded. The message identifies the field.

A test builds a report at every schema limit at once, with the widest characters and numbers, and a certificate at its budget, and expects 201. The test reads the limits from the schema. Thus, if a schema limit increases and `bodyLimit` does not, the test fails.

The limit is on the route, not on the server. The server options belong to `fastify-cli`, and the route keeps the limit next to the schema that it must agree with.

## Alternatives Considered

- **A certificate budget of 3 times its real size, thus a `bodyLimit` of 204 KiB.** Rejected: it saves approx. 50 KB of parsing for each rejected request and has no effect on the disk, because the certificate is not stored. There is only one measurement of a real certificate, and a round number is easier to use in a proxy configuration.
- **Exclude the certificate from the body size.** Rejected: Fastify checks raw bytes before it parses the body, so it cannot find the certificate in it. A header is not an option (ADR 10), and a custom streaming parser is too much for this.
- **Only `bodyLimit`, no schema limits.** Rejected: a 413 does not tell which field is wrong. A 400 from the schema does.
- **Only schema limits, no `bodyLimit`.** Rejected: `licenseCert` is not in the schema, because the auth hook removes it before validation. Also, raw JSON can be large without large values, for example with whitespace or numbers with many digits. Only `bodyLimit` bounds the raw body before it is parsed.
- **A length check for `licenseCert` in the auth hook.** Rejected: the certificate is not stored, and `bodyLimit` already bounds it before parsing.
- **Pin `instanceId` to a sha256 hex digest and `batchId` to a UUID.** Rejected: n8n lets the operator set `N8N_INSTANCE_ID` to any value. A stricter format would reject such instances permanently.

## Consequences

- Each request stores at most approx. 185 KB instead of approx. 1 MiB.
- This does not stop disk exhaustion. It only limits the size of one request. The protection against disk exhaustion is authentication (ADR 10) and network isolation.
- A proxy in front of the service must accept bodies of at least 256 KiB. The default of nginx and of the Kubernetes nginx ingress is 1 MiB.
- A new metric in n8n is limited to 1000 data points in total and to names that match the pattern. n8n must know the receiver limit, so that it can check its largest report against it in its own tests.
- If the certificate grows past its budget, or a schema limit increases, `bodyLimit` must be calculated again.
- The n8n client must treat 413 and 400 as permanent failures, because a retry sends the same payload. This is a separate change in n8n.
