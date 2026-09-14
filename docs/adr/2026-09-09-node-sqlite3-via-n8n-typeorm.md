# 8. Access SQLite through n8n's TypeORM fork, and therefore through the asynchronous node-sqlite3 driver

> _This ADR was written by AI and reviewed by a human._

Date: 2026-09-09

Status: Active

Supersedes: `adr/2026-08-26-sqlite-with-synchronous-writes.md` (ADR 7). Everything that ADR decided about the *store* stands: SQLite, `journal_mode = WAL`, `synchronous = FULL`. What it decided about the *driver* is replaced here.

## Context

This service is maintained by n8n and should stay close to the n8n tech stack. n8n accesses its database through its own TypeORM fork, `@n8n/typeorm`, and we want to adopt the same package for schema definition, repositories and startup migrations, so that anyone who knows the n8n codebase can work on this one without learning a second data layer.

The fork removes the choice of SQLite driver. Upstream TypeORM ships a `better-sqlite3` driver; `@n8n/typeorm@0.9.0` does not. Its driver factory accepts only `postgres`, `sqlite` and `sqlite-pooled`, and both SQLite drivers `require('sqlite3')` and drive its callback API. `better-sqlite3` cannot be passed through the fork's `driver` option either: its API is synchronous and has no `verbose()`. So adopting the fork means dropping `better-sqlite3`, the driver ADR 7 was written around, in favour of `sqlite3` (node-sqlite3), the package every production n8n instance on SQLite runs on today.

Two facts about node-sqlite3 shape this decision:

1. It is **asynchronous**. Every statement is dispatched to the libuv thread pool and completes via callback, so the event loop is not blocked while SQLite fsyncs.
2. Its GitHub repository is **marked deprecated and unmaintained**. The npm package is not flagged deprecated and still receives releases (6.0.1 on 2026-03-12), but the maintainers state they will not process issues or pull requests.

## Decision

**Replace `better-sqlite3` with `sqlite3`, pinned to the exact version n8n pins (`5.1.7` at the time of writing), accessed through `@n8n/typeorm`'s plain `sqlite` driver with `enableWAL: true`.**

*Same driver as n8n, same version as n8n.* The point of the fork is to share n8n's stack, and that only holds if we also share its driver. Pinning the same version means the n8n core team's assessment of node-sqlite3's deprecation, and their timing for any move away from it, covers this service too. We do not want to be the one place in the company running a different SQLite binding.

*The store decisions of ADR 7 carry over unchanged.* node-sqlite3 5.1.7 bundles SQLite 3.44.2 built with only threadsafety and extension defines; it does not set `SQLITE_DEFAULT_SYNCHRONOUS`, so SQLite's default of `FULL` applies. The fork's driver issues `PRAGMA journal_mode = WAL` only when `enableWAL` is set, `busy_timeout` only when configured, and `foreign_keys = ON` unconditionally. Nothing in the new stack weakens durability: a `201` still means the report survived a WAL fsync, which is the guarantee ADR 7 argued must not be traded away.

*A SQLite downgrade is accepted.* `better-sqlite3` 13.0.3 bundles SQLite 3.53.4; `sqlite3` 5.1.7 bundles 3.44.2, from November 2023. The releases in between add JSONB and the `->`/`->>` operators, query-planner work, `ALTER TABLE` support for adding and removing constraints, and a series of correctness fixes for UPSERT, triggers and unusual `IN`/`EXISTS` queries. None of that touches the features this service uses: one prepared `INSERT` per request, one ordered full-table read, JSON parsed in Node rather than in SQLite, no UPSERT, no triggers. We accept the older version because the improvements are not significant for what we need, and because the pin follows n8n's.

*The plain `sqlite` driver, not `sqlite-pooled`.* The pooled driver exists to solve n8n's problem of many concurrent execution writes contending on one connection, the problem behind the Slack message quoted in ADR 7. This service has one writer path, one `INSERT` per request and no multi-statement transactions, so a single connection is the correct amount of machinery. `sqlite-pooled` adds pool sizing and acquire timeouts we would have to tune blind in a deployment we cannot observe.

*Asynchrony is accepted as a side effect, not sought.* ADR 7 rejected "an asynchronous driver, or `better-sqlite3` behind a worker thread" as complexity we did not need. That reasoning was correct and is not reversed here: we would not have built this. But the ORM brings it at no code cost, and the effect is strictly positive for the failure mode ADR 7 worried about most.

**Alternatives considered:**

- *Upstream `typeorm` with its `better-sqlite3` driver.* Keeps the driver ADR 7 chose and its benchmarked numbers. Rejected: it defeats the purpose. n8n does not run upstream TypeORM, so we would be adopting an ORM for stack alignment while diverging from the stack on the ORM itself.

## Consequences

- **Head-of-line blocking is gone.** ADR 7's central accepted cost, that every fsync stalls the whole process including `/health`, no longer applies. The write runs on a libuv thread; the loop keeps serving. The ~6ms-per-commit budget from ADR 7 still holds as the *throughput* ceiling, because SQLite serialises writes regardless of driver, but exceeding it now degrades write latency rather than freezing the process. `adr/2026-08-18-fastify-over-express.md` has been corrected accordingly.
- **The future read-path risk shrinks but does not vanish.** A seconds-long reconciliation scan now occupies one of the libuv thread pool's four default threads instead of the event loop, and shares that pool with DNS and filesystem work. The requirement from ADR 7 that heavy reporting jobs run outside the request path stands, with a weaker justification.
- **Repository and service code become asynchronous.** `insert` and `findAll` return promises, the service and route handlers await them, and tests use `await` and `rejects.toThrow`. This is the bulk of the code change and is mechanical.
- **Driver error codes change.** node-sqlite3 reports a unique-index collision as `code: "SQLITE_CONSTRAINT"` with `UNIQUE constraint failed` in the message, not the extended `SQLITE_CONSTRAINT_UNIQUE` code `better-sqlite3` gave. The duplicate-batch detection that `adr/2026-08-26-report-envelopes-are-immutable.md` relies on must match on the new shape, and the existing test against a real database is what guards that.