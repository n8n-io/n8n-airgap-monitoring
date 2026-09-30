# 12. Filter the report by query parameters

> _This ADR was written by AI and reviewed by a human._

Date: 2026-09-30

Status: Active

Source: [API-299](https://linear.app/n8n/issue/API-299/filter-report-response-by-instance-instanceid)

## Context

`GET /api/v1/report` returns every instance (ADR 9). With many instances it is hard to find the one you need. API-299 adds a filter by `instanceId` and a `filters` field that records the applied filters. More filters will follow, for example `from` and `to` for a time window. So the first filter sets the rules for the next ones.

## Decision

We filter the report with query parameters and record the applied filters in the report.

- A filter with several values takes them comma-separated: `?instanceId=a,b`. Values are split on commas, trimmed, and empty ones are dropped, so `a, b` is the same as `a,b`. A repeated parameter is 400.
- `data.filters` is the applied filters as a query string, with values deduplicated and sorted, for example `instanceId=a,b`. Without filters the field is absent, as in a report from a collector older than this ADR. The string can be passed back as the query.
- A value nothing was recorded for is not an error. The response is 200 with fewer or no instances.
- An unknown parameter is ignored and is not in `filters`. A full report is the safer mistake: no data is lost, and the missing `filters` shows that nothing was applied.
- After splitting, each `instanceId` has the same limits as on ingest, 1 to 256 characters (ADR 11), and there are at most 100 ids. A value outside the limits is 400.
- The filter is a `WHERE` on the query that lists instance ids, so the report still streams one instance at a time (ADR 9).

## Alternatives Considered

- **Repeated parameter (`?instanceId=a&instanceId=b`), alone or next to commas.** Rejected: a comma-separated list is easier to type and gives a shorter `filters`, and one format is simpler to document and test.
- **400 for an unknown parameter.** Rejected: a typo would give no file at all. Ignoring also keeps an older collector usable: a caller can send a filter that the running collector version does not know yet and still gets a report. It is also more work: with `additionalProperties: false`, Ajv's `removeAdditional` strips unknown keys instead of rejecting them.
- **404 for an unknown `instanceId`.** Rejected: a filter narrows a list, and an empty list is a valid result. With several ids, one unknown id would fail the whole request.

## Consequences

- New filters follow the same rules: a query parameter, comma-separated for several values, listed in `filters`, and only narrowing.
- A file with `filters` is not the full report. The receiver must check it before it bills from the file.
- A typo in a parameter name returns the full report. The only sign is the missing `filters`.
- A filter that the running collector version does not know yet is ignored and is missing from `filters`.
- An `instanceId` that contains a comma cannot be filtered by, because it is split. The default `instanceId` is a sha256 hex digest.
- A future filter on free text, for example `label`, needs a restricted format first, or commas in it are ambiguous.
- More than 100 instances need several downloads or the full report.
