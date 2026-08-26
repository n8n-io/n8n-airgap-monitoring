# 7. Store reports in SQLite, written synchronously on the event loop

> _This ADR was written by AI and reviewed by a human._

Date: 2026-08-26

## Status

Accepted

## Context

This service aggregates instance reports into a local database, in a deployment we do not operate: the customer hosts it inside their own airgapped network, on hardware they provision, with an ops team whose size and skill we cannot assume (`adr/2026-08-18-fastify-over-express.md`). The datastore choice inherits that constraint, and until now it was never written down — the reasoning lived in a docstring in `src/plugins/db.ts`.

Three properties of the current implementation deserve separating, because only one of them was ever actually chosen:

1. SQLite as the store — a deliberate choice, but undocumented.
2. `journal_mode = WAL` — chosen, and set explicitly.
3. A **synchronous** driver (`better-sqlite3`) with `synchronous` left at SQLite's default of `FULL` — inherited defaults, never named.

Point 3 is the gap. Every accepted report performs a blocking `INSERT` with a WAL fsync, on the event loop, inside a request handler. That sits oddly next to an HTTP-layer decision argued partly on throughput, and a review reasonably flagged the tension. This ADR resolves it by naming the choice rather than by changing it.

## Decision

**SQLite, via the synchronous `better-sqlite3` driver, in WAL mode, with `synchronous` left at `FULL`.**

*SQLite* keeps the deployment one container plus one volume. There is no separate database process for the customer to provision, secure, back up, or upgrade, and no second failure mode for an operator we cannot reach to diagnose. For an append-only store taking ~0.12 writes/second, a client/server database buys nothing and costs the customer an operational component.

*A synchronous driver on the event loop* is accepted deliberately. The blocking write has two distinct costs, and they are worth stating separately because the second is the one that gets overlooked:

- It caps write throughput at one commit at a time.
- It causes **head-of-line blocking**: for the duration of each fsync, nothing else runs — not concurrent reports, not `/health`.

Measured on the real ingest path (prepared `INSERT`, realistic daily + cumulative payload, WAL):

| `synchronous` | p50 | p99 | Sustained |
| --- | --- | --- | --- |
| `FULL` (current) | 37µs | 108µs | ~22,900/s |
| `NORMAL` | 14µs | 38µs | ~51,700/s |
| `OFF` | 9µs | 37µs | ~86,900/s |

**These figures flatter `FULL` and must not be quoted as a capacity claim.** They were taken on macOS, where `fsync()` does not flush the drive's write cache — SQLite only issues `F_FULLFSYNC` under the `fullfsync` pragma, which is off. On the deployment target, a Linux container, expect roughly 0.5–2ms per commit on local NVMe and several milliseconds on a network-attached or thin-provisioned volume. What the numbers do establish cleanly is the split: the statement itself costs ~14µs and everything above that is the sync.

Against that, the load. Reports arrive at a jittered `reportTime`, so 10,000 instances average ~0.12 req/sec. The demanding case is the one `adr/2026-08-18-fastify-over-express.md` already identifies as load-bearing — jitter collapsing so that arrivals bunch into a single minute, giving ~167 req/sec. A serial writer then has a **~6ms budget per commit**. `FULL` meets that on any non-pathological storage, with two to three orders of magnitude of headroom in the ordinary case.

*`synchronous` stays at `FULL`* — and this is the part that is a decision rather than an acceptance. `NORMAL` in WAL mode is safe from corruption and is what SQLite's own documentation recommends for most WAL applications; it removes the per-commit fsync and would win the ~2.5x above. It is still wrong here. Under `FULL`, a `201` means the report survives power loss. Under `NORMAL`, it means the report survives power loss unless the machine loses power within the next few seconds — and nothing in this system heals that window:

- Rule 3 of `adr/2026-08-26-report-envelopes-are-immutable.md` forbids an instance from resending an accepted `batchId`. There is no retry.
- The compensating control is the cumulative checksum from `adr/2026-08-18-daily-metric-combined-with-cumulative.md`, which makes the gap detectable and quantifiable but explicitly does not recover it. Recovery is a manual backfill request to a customer whose network we cannot reach.
- It would invert a deliberate choice. `adr/2026-08-26-report-envelopes-are-immutable.md` makes the lost-acknowledgement case *loud* on purpose: a retry hits the unique index and fails visibly. `NORMAL` introduces the mirror-image failure — acknowledged, then lost — which is **silent**, on billing data.

Trading a durability guarantee for microseconds we have orders of magnitude of headroom on is the wrong direction. The reasoning that argues for Fastify — no observability, no remediation, no second chance — argues for the conservative default here.

**Alternatives considered:**

- *`synchronous = NORMAL`.* The measured 2.5x on the ingest path, at no corruption risk. Rejected for the durability argument above: the performance is not needed and the loss would be silent.
- *`node:sqlite`, the Node built-in.* Tempting on dependency grounds — it would drop a native module from the tree. Rejected for now: on Node 24.6 it still emits an `ExperimentalWarning` on import and its API may change, neither of which we want in a customer-hosted deployment we cannot patch. It also would not change this ADR's substance, since it exposes `DatabaseSync`/`StatementSync` and is synchronous too. Worth revisiting when it stabilises.
- *An asynchronous driver, or `better-sqlite3` behind a worker thread.* Removes head-of-line blocking. Rejected: SQLite serialises writes regardless, so this buys latency isolation rather than throughput, at the cost of a worker boundary and serialisation on every query — real complexity for a problem the measurements say we do not have.
- *A client/server database (PostgreSQL).* Rejected: it makes the customer provision and operate a second component, which contradicts the hosting-footprint requirement that drove ADR 2. The write volume does not come close to justifying it.

## Consequences

- Every accepted report blocks the event loop for the duration of one WAL fsync. The metric that matters is **per-commit sync latency**, and the threshold to care about is ~6ms — at which point a collapsed-jitter burst saturates the loop. Ordinary storage is 3–4 orders of magnitude inside that.
- **This supersedes the capacity claim in `adr/2026-08-18-fastify-over-express.md`.** That ADR asserted the customer's minimum hardware is "roughly halved" relative to Express. The write, not the router, sets this service's ceiling, so HTTP-layer headroom does not translate into provisioning headroom. The framework choice stands on its own reasoning — cost floor and absent remediation — not on a throughput figure the ingest path cannot reach.
- The write cost is a property of the customer's storage, not of our code, and we cannot observe it. This compounds with the jitter assumption in ADR 2: a bursty arrival profile *and* a slow volume is the combination that turns this decision into a problem, and neither half is visible to us.
- **A future read path is the larger risk, not the write.** `adr/2026-08-18-store-datapoints-as-json.md` contemplates fleet-wide reconciliation scans over `json_each()` costing *seconds*. WAL means such a reader does not block the writer at the database level, but a synchronous seconds-long scan on the event loop stalls every request in the process. Any reporting UI or reconciliation job must therefore run outside the request path — a separate process, or a worker thread — and that requirement follows from this ADR rather than from theirs.
- `better-sqlite3` is a native module. The container image must be built with a binary for the target architecture, so the customer's install never compiles from source.
- Tests run against `:memory:` (`src/testing/build-app.ts`), where WAL is skipped and `synchronous` is meaningless. The durability behaviour this ADR decides on is not exercised by CI, and a change to these pragmas would not fail a test.
