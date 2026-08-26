# 6. Identify the report envelope with a batchId, and make envelopes immutable

> _This ADR was written by AI and reviewed by a human._

Date: 2026-08-26

## Status

Accepted

## Context

`batchId` was a field on `DailyMetric`: each day-value carried its own id, minted when the instance closed that day. The purpose was to tell a re-sent day apart from a second instance reporting the same day, which is how duplicate instances sharing an `instanceId` are meant to surface (see the [License Server Duplicated Instances](https://app.notion.com/p/n8n/License-Server-Duplicated-Instances-2ed5b6e0c94f80338478cb53103dccff?source=copy_link#2f15b6e0c94f801a8657eabc7cc33112) note).

But an instance does not send a metric, it sends a report. The id it actually generates and persists is the one for the thing it puts on the wire, and duplicate-instance detection is a question asked of the stored corpus, not of a single metric in isolation. Meanwhile `adr/2026-08-18-store-datapoints-as-json.md` left the report's envelope fields (`instance_id`, `n8n_version`, `received_at`) as columns and only the metric content as JSON — and noted that storing metrics as JSON gives up the ability to express dedup as a unique index.

## Decision

`batchId` moves from `DailyMetric` to the top level of the report, and becomes a `batch_id` column on `instance_reports` alongside the other envelope fields. It is required.

This rests on a contract the reporting instance must honour, which is stated here because the API cannot enforce it:

1. **An envelope is immutable once sent.** A retry repeats it verbatim, under the same `batchId`.
2. **Pending envelopes are never merged, split or rebuilt.** An instance that has been unable to report for a week replays its pending envelopes one by one; it does not coalesce them into a fresh envelope covering the week.
3. **An accepted `batchId` is never sent again.**

Rules 1 and 2 are what let a report-scoped id answer a per-day question. Because a day-value only ever travels inside the one envelope that first carried it, its `batchId` is stable, exactly as a metric-scoped id would have been.

A `UNIQUE (instance_id, batch_id)` index enforces rule 3. It is a guard, not a code path: there is no dedup logic, because a reporting instance is designed never to resend an accepted batch. A repeat therefore surfaces as a constraint error rather than as a silently double-counted day. Uniqueness is scoped per instance, since two unrelated instances picking the same `batchId` is a coincidence, not a conflict.

**Constraint on duplicate-instance detection** (not yet built; see `adr/2026-08-18-daily-metric-combined-with-cumulative.md` for the reconciliation work it belongs with): the signal is *same `instanceId`, same `date`, different `batchId`, and a **conflicting value***. Differing `batchId` alone must not raise the alarm. If some future reporter violates rule 2, the value check degrades the outcome to a missed signal instead of a false accusation that a customer is running unlicensed instances. The accepted blind spot is two instances reporting identical values for a day: they look like one until they diverge.

**Alternatives considered:**

- *Keep `batchId` on `DailyMetric` (status quo).* It survives envelope re-composition without needing rule 2, and would let a long-offline instance coalesce its backlog into a single request. Rejected: the envelope is what the instance actually generates and persists, a metric-scoped id says nothing about cumulative metrics, and a report-scoped id can be a column and therefore an index.
- *Report-scoped `batchId` with server-side dedup* (`ON CONFLICT DO NOTHING`, return the existing id). Rejected: it writes and maintains a code path for a delivery the reporting instance is built not to make.

## Consequences

- Reconnecting after a long outage costs one request per pending envelope. Coalescing is forbidden by rule 2, and wanting it is the thing that would force revisiting this ADR — a metric-scoped id is the alternative to return to.
- Idempotency is enforced by the database rather than by each write path, which is a guarantee `adr/2026-08-18-store-datapoints-as-json.md` had to forgo for metric-level semantics. Any second write path (backfill, manual adjustment) inherits it for free.
- A lost acknowledgement is the one case where a well-behaved instance cannot honour rule 3: it committed on the server but the instance never learned so. Retrying then hits the unique index and fails loudly. That is deliberate — the failure is visible and its cause is recorded — but it does mean an operator may see constraint errors that are not a client bug.
- The contract is documented, not enforced. Nothing in the request schema stops an instance from rebuilding an envelope, and the collector runs at whatever version the customer deployed (`adr/2026-08-18-backwards-compatibility-via-n8n-version.md`). The value check above is the compensating control.
- Breaking change to the request body: `batchId` is now required at the top level and rejected on a metric. A metric-level `batchId` from an older reporter is stripped by `removeAdditional` rather than rejected, so such a report is still accepted — it simply loses an id that no longer means anything.
