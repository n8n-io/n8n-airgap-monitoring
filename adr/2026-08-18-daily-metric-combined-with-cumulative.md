# 1. Reconcile daily usage metrics with a cumulative checksum

Date: 2026-08-18

## Status

Accepted

## Context

Billable usage (e.g. `billableExecutions`) is reported as a `DailyMetric`: one value per UTC calendar day. Scoping each report to a single day bounds the damage of a customer-side DB rollback to the affected days, instead of corrupting a lifetime counter the way a pure running total would.

That bound is not zero, though. If a daily window is never shipped at all — the instance is offline across a reporting cycle, a report is dropped, or an outbox never recovers after a rollback — the gap is invisible from the server's point of view. Nothing distinguishes "this instance had zero billable executions on 2026-03-22" from "this instance's 2026-03-22 report never arrived." Under-billing from a missing window is silent and, unlike a monotonic counter, leaves no numerical trace to notice it by.

## Decision

Alongside the daily metric used for billing, the reporting instance also sends a `CumulativeMetric` lifetime counter for the same underlying quantity, e.g. `{ kind: 'daily', name: 'prodExecutions', ... }` for the day plus `{ kind: 'cumulative', name: 'prodExecutionsLifetime', value }` in the same report. The `Metric[]` union already allows both kinds in one `dataPoints` array, so this needs no new report shape.

Billing continues to be computed from the daily series, never from the counter — the counter is not a source of truth, only a checksum. Periodically, for each instance, the sum of daily values across a span is compared against the counter's delta over that same span:

- `sum(dailyValues) == delta(counter)` — no gaps, nothing to do.
- `sum(dailyValues) < delta(counter)` — one or more daily windows are missing, and the difference is exactly how many executions they're worth.

This converts the daily model's one remaining weakness — a silent gap — into a measured, alertable quantity, for the cost of one extra number per report.

**Alternatives considered:**

- *Cumulative-only billing.* Rejected: a customer DB rollback corrupts the lifetime counter directly, and the resulting under-count is silent and unrecoverable — there's no reliable way to tell a rollback-induced reset apart from legitimate usage after the fact.
- *Daily-only, no reconciliation signal (status quo).* Rejected as the sole mechanism: gaps are bounded in size by reporting cadence, but remain undetectable without a second signal to compare against.
- *Resending a trailing window of recent days on every report* was also raised as a way to self-heal gaps, but is a separate, complementary idea (it changes what gets sent, not how correctness is verified) and is left for a future ADR if pursued.

## Consequences

- Missing daily windows become detectable and quantifiable instead of silently absorbed into a lower bill — the checksum tells us both that a gap exists and how large it is.
- Marginal cost is one extra numeric field per relevant metric per report; no schema redesign, since `CumulativeMetric` already exists in the `Metric` union.
- A reconciliation job/query is now needed: per instance and per metric, sum daily values and compare against the counter's delta over the same span. This is new logic that doesn't exist yet.
- Detecting a gap does not recover the missing data or fix the bill by itself — a confirmed gap still needs a follow-up process (flag the report, request a backfill, or apply a manual adjustment).
- The counter and the daily series can drift for reasons unrelated to gaps (e.g. a bug in either code path), so the reconciliation check needs a tolerance/threshold rather than treating any mismatch as a confirmed gap.
- The lifetime counter inherits the general risks of any cumulative value on the instance side (e.g. it must be a dedicated persisted counter, not derived from a pruned execution table) — but since it's used only as a checksum here, not for billing, an occasional rollback-induced dip in the counter degrades the check's sensitivity rather than the bill's correctness.
