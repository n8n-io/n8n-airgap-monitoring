# 5. Store report dataPoints as JSON rather than normalized metric rows

> _This ADR was written by AI and reviewed by a human._

Date: 2026-08-18

## Status

Accepted

## Context

With `dataPoints` now an array of structured metrics (`daily` with `batchId`/`date`, `cumulative`; see `adr/2026-08-18-daily-metric-combined-with-cumulative.md`), the unit of meaning shifted from the report to the individual metric, and the committed read paths — billing sums and the daily-vs-cumulative reconciliation — aggregate over metrics, not reports. That invites a normalized `instance_report_metrics` table with per-metric columns, CHECK constraints and indexes. At the same time, `adr/2026-08-18-backwards-compatibility-via-n8n-version.md` establishes that this collector's job is capture, not interpretation: it runs at whatever version the customer deployed, possibly for years, and must retain payloads it does not fully understand.

## Decision

The `instance_reports` table stays as it is: append-only, one row per report, `dataPoints` stored as the JSON that arrived. No per-metric table.

- **Normalization is interpretation at write time.** A schema that enumerates kinds and per-metric fields in DDL caps what a frozen collector can retain: a new metric field has no column, a new kind fails the CHECK constraint, and fixing either requires the collector update we cannot schedule. JSON storage keeps the write path version-agnostic, so evolution on the reporting side lands as data, not as rejections.
- **The read load does not justify per-metric indexes.** Per-instance queries use the existing `(instance_id, received_at)` index and touch ~365 rows per instance-year. Fleet-wide billing and reconciliation are periodic batch jobs; scanning a few million rows with SQLite's `json_each()` costs seconds, which is acceptable at that cadence. No interactive per-metric query path exists today.

**Alternatives considered:**

- *Normalized `instance_reports` + `instance_reports_metrics` tables.* Best query ergonomics and DB-enforced invariants (CHECK constraints, partial indexes, per-metric dedup as a unique index). Rejected: it violates the capture principle above — the deployed collector's DDL becomes a permanent ceiling on what is retained — and every envelope change becomes a migration gated on customer deployments.
- *JSON log as source of truth plus a rebuildable normalized projection, written in the same transaction.* Preserves capture and provides indexed reads, and remains the growth path (see below). Rejected for now: maintaining two representations of the same data — dual writes, rebuild machinery, and a "which table is the truth" rule every contributor must know — is more complexity than the current read requirements justify.

## Consequences

- Metric-level semantics live in read-side code, not in the database: the daily-vs-cumulative rules and value typing are enforced only by Ajv at the HTTP boundary and by whatever queries consume the rows. Any second write path (backfill, manual adjustment) must reuse the same validation, because the database will accept anything. Report-level uniqueness is the exception — `adr/2026-08-26-report-envelopes-are-immutable.md` moved `batchId` to a column, so a unique index enforces it for every write path.
- Reads that aggregate across the fleet are full scans by design. If an interactive query path emerges that measurably cannot be served by scans, the remedy is the projection alternative above — added later and rebuilt from the JSON log. That migration is possible in this direction; a normalized-only schema could not recover discarded JSON, which is part of why JSON wins now.
- Storage grows unbounded until compaction exists. The intended remedy is snapshotting: periodically aggregate old raw events into snapshot rows and prune the raw `dataPoints` they cover. That future design inherits two constraints worth stating now:
  - A snapshot reflects what the *deployed* collector understood at snapshot time. Pruning raw data destroys the "interpret later" reserve of `adr/2026-08-18-backwards-compatibility-via-n8n-version.md` for that range — so prune only ranges old enough that reinterpretation is no longer expected, and skip (or retain raw) reports containing content the snapshot code did not interpret.
  - The raw log is the audit evidence for a disputed invoice. Raw retention must exceed the dispute window, and a range should only be pruned once billing for it is settled.
- The JSON blob stores the *post-validation* body (Ajv `removeAdditional` has already stripped unknown fields). For rungs two and three of ADR 4's compatibility ladder to actually capture unknown content, per-metric validation needs to be loosened (validate known kinds strictly, pass unknown kinds and fields through). That is a follow-up decision on the validation layer, not on storage — but this storage model is what makes it worth taking.
