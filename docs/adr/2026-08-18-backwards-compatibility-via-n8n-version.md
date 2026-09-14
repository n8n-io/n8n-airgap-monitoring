# 4. Handle version skew through the report's n8nVersion, not through collector releases

> _This ADR was written by AI and reviewed by a human._

Date: 2026-08-18

## Status

Accepted

## Context

Both ends of the reporting contract are deployed by customers. n8n instances upgrade on the customer's cadence, and so does this collector — we cannot see which version a customer runs, cannot push an update, and in an airgapped network cannot even assume a newer version is *reachable* on any schedule. Version skew between reporter and collector is therefore not a transition state to engineer away but the permanent operating condition, in both directions: an instance newer than its collector must still report successfully (a rejected report is a silently missing billing window, the exact failure mode `adr/2026-08-18-daily-metric-combined-with-cumulative.md` exists to catch), and an instance older than its collector will keep reporting for years wherever customers pin n8n versions.

The usual remedies assume deployment control we don't have: "ship the new API version first, then migrate clients" requires orchestrating the collector upgrade ahead of the instance fleet — precisely the step we cannot schedule.

## Decision

Every instance report carries the reporting instance's `n8nVersion`, and the collector persists it verbatim on the stored event. Compatibility is then handled in two tiers:

1. **Prefer additive evolution, so no version branching is needed at all.** The ingest contract is deliberately lenient about content: metric *names* are unconstrained and `dataPoints` are stored as the JSON that arrived, so a newer instance can ship an entirely new metric through an old collector and have it stored — interpretable later, with zero collector changes. Unknown report fields are accepted rather than rejected.
2. **When interpretation genuinely must differ by reporter version** — a renamed metric, changed units, corrected semantics — **the conditional logic lives at read time**, in whatever consumes the stored events (billing, reconciliation, a reporting UI), keyed off the persisted `n8nVersion`. The ingest path never branches on version: it stays a dumb, stable funnel that old and new instances alike can hit. Because the version is stored per event, history remains interpretable indefinitely — a consumer can apply the right reading to old rows long after every instance has moved on.

Under the current schema, "additive" means precisely this ladder:

- **New metric name under an existing kind** — fully stored and forward-compatible. The ideal evolution path; changes should be designed to land here.
- **New optional field (top-level or per-metric)** — the report is accepted (nothing breaks), but an old collector strips the unknown field at validation (Ajv `removeAdditional`), so that field's data is not retained until the collector updates. Safe but lossy: acceptable for cosmetic fields, not for billing data.
- **New metric `kind`, or any change to the envelope** — rejected by old collectors with a `400`. A breaking change, to be avoided; if unavoidable, the *instance* side must gate sending it (old n8n versions simply never emit it, and a collector too old to accept it turns into a visible report failure on the instance, not silent data loss).

The same discipline applies in reverse: the collector must never make a new report field required, because instances predating it will keep reporting long after it ships.

**Alternatives considered:**

- *URL versioning as the routine mechanism (`/api/v2/ingest`).* The path already carries `/v1/`, and a wholesale contract break would still bump it. Rejected as the primary tool because a new URL only exists once the customer upgrades the collector — the step we cannot schedule — and until then every instance behind that collector is gated on it.
- *Version-branching at ingest* (normalize old payload shapes to the newest one on arrival). Rejected: it concentrates the long-term compatibility overhead in the one component we most need to stay stable and rarely updated, and a normalization bug at write time corrupts stored records permanently, whereas a read-time bug is fixable retroactively because the stored payload is untouched.
- *Strict semantic validation at ingest.* Rejected: an old collector rejecting a newer instance's report converts version skew into missing billing windows.

## Consequences

- New metrics reach customers without a collector release, and a customer who never updates the collector still produces complete billing data — the collector's job is capture, not interpretation.
- Version-conditional logic accumulates in read-side consumers over time. This is accepted overhead, but bounded: each conditional exists to interpret *stored data* from a version range, so it can be deleted when data from that range ages out of retention — not when the fleet upgrades, which we could never verify anyway.
- The leniency is load-bearing contract, not accident: the ingest tests asserting that unknown fields are accepted are contract tests, and tightening the schema (e.g. `additionalProperties` from strip to reject) is a compatibility decision, not a cleanup.
- Storing `dataPoints` as arrived (JSON) is what makes rung one of the ladder work. Any future storage normalization must preserve at least open metric names — which a `name`/`value`/`kind` column layout does — and must re-evaluate the other rungs before changing what is retained.
- `n8nVersion` is self-reported and sits outside our trust boundary, like the rest of the payload: valid input for interpretation, never for authentication or trust decisions.
- Read-side consumers need a shared way to compare versions ("before 1.105" style guards), which does not exist yet; the first version-conditional read introduces it.
