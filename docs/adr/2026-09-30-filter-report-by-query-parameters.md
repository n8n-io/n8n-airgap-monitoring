# 12. Filter the report by query parameters

> _This ADR was written by AI and reviewed by a human._

Date: 2026-09-30

Status: Active

Source: [API-299](https://linear.app/n8n/issue/API-299/filter-report-response-by-instance-instanceid)

## Context

`GET /api/v1/report` returns every instance (ADR 9). With many instances it is hard to find the one you need. API-299 adds a filter by `instanceId` and a `filters` field that records the applied filters. More filters will follow, for example `from` and `to` for a time window. So the first filter sets the rules for the next ones.

## Decision

We filter the report with query parameters and record the applied filters in the report.

- A filter with several values repeats the parameter: `?instanceId=a&instanceId=b`. A comma is not a separator, because `instanceId` is free text (ADR 11) and can contain a comma.
- `data.filters` is the applied filters as a query string, with values deduplicated and sorted, for example `instanceId=a&instanceId=b`. Without filters it is `""`. The string can be passed back as the query.
- A filter only narrows the report. An instance's entry is the same with or without a filter. Nothing is aggregated, the collector stays a dumb pipe (`adr/2026-08-26-report-envelopes-are-immutable.md`).
- A value nothing was recorded for is not an error. The response is 200 with fewer or no instances.
- An unknown parameter is ignored and is not in `filters`. A full report is the safer mistake: no data is lost, and the empty `filters` shows that nothing was applied.
- `instanceId` has the same limits as on ingest, 1 to 256 characters (ADR 11), and at most 100 values. A value outside the limits is 400.
- The filter is a `WHERE` on the query that lists instance ids, so the report still streams one instance at a time (ADR 9).

## Alternatives Considered

- **Comma-separated values (`?instanceId=a,b`).** Rejected: an id that contains a comma is ambiguous.
- **400 for an unknown parameter.** Rejected: a typo would give no file at all. Ignoring also keeps an older collector usable: a caller can send a filter that the running collector version does not know yet and still gets a report. It is also more work: with `additionalProperties: false`, Ajv's `removeAdditional` strips unknown keys instead of rejecting them.
- **404 for an unknown `instanceId`.** Rejected: a filter narrows a list, and an empty list is a valid result. With several ids, one unknown id would fail the whole request.

## Consequences

- New filters follow the same rules: a query parameter, repeated for several values, listed in `filters`, and only narrowing.
- A file with a non-empty `filters` is not the full report. The receiver must check it before it bills from the file.
- A typo in a parameter name returns the full report. The only sign is the empty `filters`.
- A filter that the running collector version does not know yet is ignored and is missing from `filters`. A collector older than this ADR has no `filters` field and always returns the full report.
- More than 100 instances need several downloads or the full report.
