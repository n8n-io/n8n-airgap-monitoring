# 13. Sanitize the instance label

> _This ADR was written by AI and reviewed by a human._

Date: 2026-10-01

Status: Active

Source: [API-410](https://linear.app/n8n/issue/API-410/sanitize-the-provided-instance-report-label)

## Context

`label` in `POST /api/v1/instance-reports` is free text from `N8N_INSTANCE_REPORTING_LABEL`, 1 to 200 characters. Consumers of the report want to use it in URLs without cleaning it up first. ADR 12 also notes that a future filter on `label` needs a restricted format, or commas in it are ambiguous.

A rejected report is more dangerous than a bad label. The n8n client retries a rejected report and then skips it, and a retry sends the same payload (ADR 11). A pattern on `label` in the schema would therefore reject every report of that instance until the operator changes the variable.

## Decision

The service sanitizes the label before it stores it, and never rejects a report because of the characters in it or its length.

The schema only requires a string, with no length limits: a too long label is cut, and an empty one is stored as `null`.

Since the label is user-provided, we don't want to expose this as a surface to break the integration.

## Consequences

- Every label stored from now on matches `^[a-z0-9]+(-[a-z0-9]+)*$` and has at most 200 characters.
- Only `bodyLimit` bounds the raw label (ADR 11). The test of the body limit sizes the label at the 200 characters that are stored. A real report leaves approx. 245 KB for the label, so only an absurd label gets 413.
- A report can still show an unsanitized label for an instance that has not reported since the upgrade.
- Letters without an accent-free form are dropped: `Straße` becomes `stra-e` and `Łódź` becomes `odz`. Labels in other scripts, for example `日本`, are dropped completely.
- Two different labels can become the same, for example `Acme Prod` and `acme_prod`. The label is not the identity, `instanceId` is.
- A future filter on `label` can split on commas, because a stored label contains none.

## Links

Documentation: [USER_GUIDE.md](../USER_GUIDE.md)

Related ADRs: [ADR 11](2026-09-24-bound-instance-report-size.md), [ADR 12](2026-09-30-filter-report-by-query-parameters.md)
