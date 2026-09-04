# 8. Stream the usage report one instance at a time

> _This ADR was written by AI and reviewed by a human._

Date: 2026-09-04

## Status

Accepted

## Context

`GET /api/v1/report` exports everything the collector has stored, as a JSON file a customer hands to n8n for billing. Its size is set by the fleet: a realistic deployment aggregates on the order of 1,000 instances, and each keeps a year of history in the live table (older years are moved out once billed). That is ~365,000 rows and ~1.8M data points, which render to a **186 MB** document.

The first implementation read the whole table with a single `SELECT`, grouped it in memory, and returned one object for Fastify to serialize under a response schema. Measured at that size: **~2.0 s of blocked event loop and ~2.4 GB peak RSS**. Both numbers are disqualifying. The memory alone OOM-kills a container with any ordinary limit, and it takes the ingest path down with it; `adr/2026-08-26-sqlite-with-synchronous-writes.md` had already anticipated this exact failure and required that "any reporting UI or reconciliation job must run outside the request path".

## Decision

**The report is produced and written one instance at a time. Nothing holds more than a single instance's history, and control returns to the event loop between instances.**

Three parts have to hold together; any one of them missing gives the memory back.

1. *The read is per instance.* `findAll()` is gone. The repository exposes `findInstanceIds()` and `findByInstance(instanceId)`, and a new index `(instance_id, received_at, id)` turns the per-instance lookup into a `SEARCH` rather than a scan. This index is load-bearing — without it, one download becomes 1,000 full table scans.
2. *The service yields.* `reportStream()` returns `generatedAt` plus a generator that produces one `InstanceReportEntry` per `next()`. A test asserts no instance is read from the database before its entry is pulled.
3. *The route writes as it reads.* The handler returns a `Readable` over an async generator that emits the JSON framing and one serialized instance per chunk.

**There is no response schema on this route** (removed in its own commit, ahead of this change). Fastify's `fast-json-stringify` serializes a whole payload in one synchronous pass, which is precisely the cost being removed, so streaming and a response schema are mutually exclusive. Dropping it is independently justified: serializing against a schema *rewrites* the payload rather than checking it, and a metric value stored as the string `"42"` left the export as the number `42`. Ingest refuses that same trade deliberately — `app.ts` sets `coerceTypes: false` so a bad value is rejected rather than silently corrected — and an export that repairs its own billing figures on the way out undoes that decision. It was not usable as a published contract either: `additionalProperties: false` cannot see a `date` declared inside a `then` branch, so ajv rejects every daily point it describes; it only behaved as intended because `fast-json-stringify` implements serialization semantics rather than validation. The shape is instead pinned by the `ReportedMetric` union at its only construction site, which names each field explicitly rather than spreading the parsed JSON, plus unit tests.

Measured end to end over real sockets, 1,000 instances, with ingest POSTs running throughout the download:

| | Before | After |
| --- | ---: | ---: |
| Peak server RSS | ~2,400 MB | **77 MB** (54 MB idle) |
| Ingest during download | blocked | **53 POSTs**, median 1.5 ms, p95 2.2 ms, max 20.3 ms |
| Time to first byte | ~2,000 ms | **21 ms** |
| Total download | ~2,000 ms | 1,167 ms |
| Longest single stall | ~2,000 ms | 3.0 ms |

Memory grows far slower than the payload rather than being strictly flat: driving the service in isolation costs +52 MB of peak RSS at 200 instances and +99 MB at 1,000, so a 5× payload buys ~1.9× the increment. That residue is V8 heap slack from allocation churn, not retention — the server process peaked at 77 MB while writing a 186 MB document, in two separate runs.

The first download after start is slower: 489 ms to first byte and one ingest POST at 500 ms, from the cold page cache on the first read of a 365,000-row table. Warm figures are the ones tabled above.

**One implementation detail is not optional and is easy to get wrong.** The renderer is an `async` generator that `await`s `setImmediate()` between instances. Without that await, `Readable.from` pulls the generator through the *microtask* queue, which drains completely before Node handles any I/O. The first version did exactly this: memory was fixed, and ingest was still blocked for the entire download — one POST completed, at 1,753 ms. Streaming bounds the memory; the explicit yield is what buys the fairness. Neither `inject()`-based route tests nor a memory benchmark catch its absence.

**Alternatives considered:**

- *A worker thread with its own read-only connection*, as `adr/2026-08-26-sqlite-with-synchronous-writes.md` suggests. It fixes blocking and, with the report built off-thread, memory too. Rejected: worker lifecycle, error propagation, a second connection for `onClose` to manage, and a native module loaded twice — real complexity, where streaming solves the same problem inside the existing request path.
- *Chunked reads with `setImmediate` yields, keeping a single final serialization.* Fixes the stall, not the 186 MB string or the retained rows. Rejected: memory is the fatal half.
- *NDJSON, one instance per line.* Equivalent on memory and simpler to frame, but it changes a response shape already documented and shipped. Rejected: the same JSON document can be streamed, so the break buys nothing.
- *Keeping the response schema and accepting the cost.* Impossible alongside streaming, and unwanted regardless: see the silent coercion and the unusable-contract arguments above. Worth recording what it did **not** do, since it was asserted during review and then disproved by measurement — a stored `daily` point missing its `date` does not fail the request. `fast-json-stringify` throws `"date" is required!` when driven directly, but on this route the point is simply emitted without the field and the response is a normal `200`.
- *Pinning a `MAX(id)` snapshot so every query reads one moment.* Implemented, then removed. The table only grows, so a report arriving mid-download can add to the export but never change what has already been written, and every point already names the `batchId` and `receivedAt` it arrived with. Not worth threading an extra parameter through two layers.
- *`ORDER BY id` instead of `ORDER BY instance_id, received_at, id` on the old single scan.* ~30% off the scan, by assuming id order matches receipt order. Rejected before this change and now moot: the repository accepts a caller-supplied `receivedAt`, so the assumption is unenforced, and breaking it corrupts `firstSeen`, `lastReportAt` and `label` silently.

## Consequences

- **Errors after the first byte cannot change the status code.** A read that fails partway aborts the transfer rather than returning 500, so a failed download arrives truncated. It will not parse as JSON, which is the signal to retry; the failure is logged with the instance id. This is a real regression against the old all-or-nothing behaviour, accepted because the alternative is not having the endpoint at scale.
- **No `Content-Length`.** The response is `Transfer-Encoding: chunked`, so a download shows no percentage.
- **The export can contain data received after its own `generatedAt`**, by up to the download duration, and different instances are read at slightly different moments. Benign for reconciliation, since each point carries its own `receivedAt`.
- **`idx_instance_reports_instance_received` is required, not an optimisation.** Dropping it silently turns each download into 1,000 table scans. First boot after upgrade builds it before the service accepts traffic — a second or two on an existing large database.
- **The response shape is enforced by TypeScript and tests, not at runtime.** `ReportedMetric` plus unit tests replace the schema. A change to the wire format now needs the README updated by hand; nothing will fail if it is not.
- **`toEntry` assumes rows are never deleted.** An instance appears in `findInstanceIds()` because it has rows, and `findByInstance()` is called afterwards; the code indexes `rows[0]` unguarded. A future retention or archive job that deletes rows while a download is in flight breaks that assumption.
- **This satisfies the read-path requirement in `adr/2026-08-26-sqlite-with-synchronous-writes.md`** without moving work off the process, which that ADR assumed would be necessary. Per-instance queries are short enough (~1 ms) that the request path is an acceptable home for them.
- **CI does not verify the properties this ADR is about.** The tests assert shape, laziness, chunked encoding and malformed-row tolerance, but not peak memory and not that the event loop stays free — both too flaky for the suite. The `await setImmediate()` could be deleted and every test would still pass. Verification is a manual benchmark against a seeded 1,000-instance database.
