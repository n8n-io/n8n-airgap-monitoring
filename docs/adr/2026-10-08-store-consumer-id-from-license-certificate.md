# 14. Store the consumerId from the license certificate

> _This ADR was written by AI and reviewed by a human._

Date: 2026-10-08

Status: Active

Supersedes: in part ADR 10 (Authenticate reporting instances with their n8n license certificate), which stored nothing from the certificate.

## Context

ADR 10 made the license certificate a credential and nothing more: possession proved "licensed by n8n", no identity was read, nothing was stored or exported. It rejected persisting license fields because ephemeral certificates carried an all-zeros `consumerId` and the fields had no use here.

Both premises have changed. The fleet report is what the customer hands to n8n, and n8n needs to know which customer each reporting instance belongs to. The license server is being changed so that ephemeral certificates for airgapped customers carry a unique `consumerId`. The payload is decrypted anyway: its signature is computed over the plaintext, so verification cannot happen without it.

## Decision

In certificate mode the service reads one value from the verified payload, `consumerId`, stores it with every report, and exports it per instance.

- The value is stored verbatim. The all-zeros placeholder is a fact about the certificate and is kept as such; interpreting it is the receiving side's job. A `consumerId` is a UUID, so a value longer than 40 characters is rejected as invalid; the bound lives in code, since SQLite enforces no column width.
- A certificate whose payload has no string `consumerId` is rejected with the new `PAYLOAD_INVALID` code, logged like every other rejection: the code and nothing else. A report that cannot be attributed is not wanted.
- The id comes only from the certificate. The body schema does not accept a `consumerId`, so a client cannot supply one in either mode. In token mode no certificate is looked at and the column is null.
- The export shows, per instance, the `consumerId` of its latest row, as it does for the label. A `consumerId` never changes over an instance's life except from the placeholder to a real id, so the latest row carries the most informative value. Every row keeps its own value, so a conflicting id, which would indicate a cloned instance or a swapped license, stays detectable downstream.

Nothing else from the payload is read, stored, logged or exported.

## Alternatives Considered

- **Accept a certificate without a `consumerId` and store null.** Rejected: it keeps unattributable reports flowing silently. Every certificate the license server issues carries the field, so rejection costs nothing on the happy path and surfaces a broken certificate immediately.
- **Normalise the all-zeros placeholder to null on ingest.** Rejected: it hides a true fact about the certificate and the rule would outlive the placeholder.
- **Latest non-null `consumerId` among the rows.** Rejected: it differs from the latest row only when a service switches from certificate mode to token mode, which is not a supported path.
- **Detect a changed `consumerId` on ingest.** Not done: it needs a read before every write, and the rows keep every value, so reconciliation can detect it later, as it does for data points.

## Consequences

- The schema gains a nullable `consumerId` column through a migration; rows stored before it read back as null.
- The export format gains `consumerId` per instance, documented in the user guide.
- The statement in ADR 10 that nothing is read from the certificate no longer holds for this one field. The rest of that ADR stands.

## Links

Related ADRs: ADR 10 (authenticate with license certificate)
