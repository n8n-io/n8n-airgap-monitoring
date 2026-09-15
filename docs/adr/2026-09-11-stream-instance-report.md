# 9. Stream the instance report download instead of building it in memory

> _This ADR was written by AI and reviewed by a human._

Date: 2026-09-11

Status: Active

## Context

`GET /api/v1/report` is the billing export: the whole history of every instance, downloaded as one JSON file (`adr/2026-08-18-store-datapoints-as-json.md`, `adr/2026-08-26-report-envelopes-are-immutable.md`). Its first implementation (API-203) built the entire response in memory — `repository.findAll()` loaded every row, the service folded them into one `instances[]` array, and Fastify then serialised and schema-validated that whole object before a byte went out. Three full-size copies of the export existed at once, at the peak.

Unfortunately, it can't scale easily. The store holds one row per instance per report (`adr/2026-08-18-daily-metric-combined-with-cumulative.md`), so at ~1000 instances reporting daily over months the export is hundreds of megabytes and the in-memory build runs the service out of memory.

## Decision

**Generate and send the report as a stream, one instance at a time, and drop the response schema.**

The report keeps the exact same JSON envelope as API-203 (`{ data: { generatedAt, instances: [...] } }`) — consumers do not change. What changes is how those bytes are produced:

- **Repository reads per instance, not all at once.** `findAll()` is replaced by `findInstanceIds()` (a `DISTINCT instanceId`, served by the leading column of the existing `(instanceId, batchId)` index) and `findByInstanceId()` (one instance's rows, oldest-first). The whole event store is never resident.
- **The service yields entries lazily.** `generateReport()` becomes an async generator, `streamInstanceReports()`, that loops the instance ids and yields one built `InstanceReportEntry` at a time. Folding rows into an entry is a pure transform (`toEntry`/`toNamedMetrics`/`byName`), and nothing is deduplicated or summed — the collector stays a dumb pipe (`adr/2026-08-26-report-envelopes-are-immutable.md`, `adr/2026-08-18-daily-metric-combined-with-cumulative.md`).
- **The route streams the envelope.** It returns a `Readable` that writes the fixed head, each entry as its own `JSON.stringify` chunk separated by commas, then the tail. Only one instance's history is serialised at any moment, so peak memory tracks the *largest single instance*, not the fleet size.
- **No response schema.** Re-validating a multi-hundred-megabyte payload at runtime would undo the streaming, and it is redundant: TypeScript pins the shape at build time. A test parses the raw streamed bytes so the hand-assembled envelope cannot silently become invalid JSON.

## Consequences

- **Peak memory is bounded by the largest single instance's history, not by the number of instances or total rows.** 
- **The export is now N+1 queries** (one `DISTINCT`, then one per instance) instead of a single `findAll`. This is a deliberate trade of DB round-trips for flat memory. It is acceptable because the download is rare and each query is index-backed; it runs on the async `sqlite3` driver (`adr/2026-09-09-node-sqlite3-via-n8n-typeorm.md`, ADR 8), so it does not block the event loop between chunks the way a synchronous seconds-long scan would have.
- **A mid-stream failure produces a truncated download, not an error status.** Once the first chunk is written the `200` is on the wire and cannot be taken back, so a DB error after that breaks the connection and the client gets a short file. The stream's `error` is logged (`request.log.error`) so the failure is visible server-side rather than looking like a clean short download. A client must treat a truncated body as a failed download; there is no partial-success contract.
- **Nothing validates the response shape at runtime.** With the schema gone, a shape regression would only be caught by TypeScript and by the tests (including one that `JSON.parse`s the raw stream), not by a running server. This is the accepted cost of not making a second full pass over the payload.
- This does **not** move fleet-wide reconciliation off the request path — the concern `adr/2026-08-26-sqlite-with-synchronous-writes.md` raised for heavy `json_each()` scans still stands for any such future job. This ADR only fixes the export's memory profile; it is still a request-path read.
