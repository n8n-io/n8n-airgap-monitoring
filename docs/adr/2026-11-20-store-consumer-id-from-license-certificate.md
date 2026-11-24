# 14. Store the consumerId from the license certificate

> _This ADR was written by AI and reviewed by a human._

Date: 2026-11-20

Status: Active

Source: [API-451](https://linear.app/n8n/issue/API-451/store-consumerid-from-license-certificate-in-db)

Supersedes: in part [ADR 10](2026-09-21-authenticate-with-license-certificate.md)

## Context

A downloaded airgap-monitoring report could not be matched to a customer. The license server now issues airgapped certificates with a unique `consumerId`, and that id is already inside the certificate this service verifies. ADR 10 stored nothing from the certificate because ephemeral licenses then shared an all-zero `consumerId`. That is no longer true of the licenses n8n issues for airgapped customers.

The payload also contains `renewalToken` and `managementJwt`. Those are secrets. The certificate itself must not be stored: anyone who can read the export could otherwise copy a working license.

## Decision

We store the `consumerId` from the verified license payload and nothing else from it.

The value must be a UUID, `8-4-4-4-12` hex, either case. It is stored verbatim, including the all-zero UUID on older licenses. A payload that is not a JSON object, or whose `consumerId` is missing or not a UUID, fails verification with `PAYLOAD_INVALID` and the report is not stored. The error log carries that code and not the value.

The id comes from the certificate, never from the request body. Token-mode reports store `NULL`. [API-634](https://linear.app/n8n/issue/API-634/send-consumerid-from-n8n-instance-when-write-token-auth-is-used-for) covers sending one in that mode.

`GET /api/v1/report` adds `consumerIds` on each instance: the sorted, non-null ids of reports that instance sent whose `receivedAt` falls on a UTC day inside `start`/`end`. The field is `[]` when that instance's reports in the window had no certificate. A license swap on one instance is two ids on that instance, next to the executions it reported.

## Alternatives Considered

- **An opaque string of 1 to 40 characters.** Rejected: the license server writes a UUID, and four spare characters are not a new format. A format change ships as a new image of this service.
- **Accept a missing `consumerId` as null.** Rejected: every airgapped license n8n issues has one, and a report without it cannot be matched to a customer.
- **Normalise the all-zero UUID to null.** Rejected: it is a real id on licenses issued before consumer ids were unique, and the receiver should see it.
- **One `consumerId` per instance, latest row wins.** Rejected: a cloned instance or a swapped license disappears from the export. The instance carries every distinct id instead.
- **A top-level list and no per-instance list.** Rejected: several instance-locked licenses make one list unable to attribute an instance's usage.
- **A top-level list as well as the per-instance lists.** Rejected: it only repeats those lists.
- **Validate only on ingest and detect conflicts there.** Rejected: that needs a read before every write, and the export already shows every distinct id.

## Consequences

- New certificate-mode rows carry `consumerId`. Rows from before this column, and token-mode rows, are null and do not appear in `consumerIds`.
- A certificate without a UUID `consumerId` gets `401`. Operators see `PAYLOAD_INVALID` in the log.
- `consumerIds` uses the receipt day. An instance can appear in `instances` because a daily metric falls in the window while its `consumerIds` stays empty, when the report that carried that point was received outside the window.
- Switching a deployment from certificate mode to token mode is not a supported path. Later rows are null, and the export skips null.

## Links

RFC: [Shared unique license identifier](https://app.notion.com/p/n8n/RFC-Shared-unique-license-identifier-for-license-server-and-n8n-airgap-monitoring-reports-3f25b6e0c94f80beb3a1d5b1c021aa29)

Documentation: [AUTHORIZATION.md](../AUTHORIZATION.md), [USER_GUIDE.md](../USER_GUIDE.md)

Related ADRs: [ADR 10](2026-09-21-authenticate-with-license-certificate.md)
