import {
  authedFetch,
  type PendingMonth,
  type ReportDestination,
  recordSubmission,
  reportReadError,
  reportUrl,
  UnauthorizedError,
} from './api'
import { formatMonth } from './format'

/** Generous: a large fleet's month is megabytes even gzipped, and office uplinks are slow. */
const SEND_TIMEOUT_MS = 5 * 60 * 1000

/** Thrown when n8n could not be reached or did not accept the data, so the page offers a manual upload. */
export class DestinationError extends Error {}

/**
 * Sends one month to n8n exactly as this service reports it: the report stream is gzipped on its
 * way through and never parsed or changed, so the tab holds only the compressed bytes.
 */
export async function sendMonth(
  pending: PendingMonth,
  destination: ReportDestination,
): Promise<void> {
  const name = formatMonth(pending.month)

  const report = await authedFetch(reportUrl(pending))
  if (!report.ok || report.body === null) {
    throw reportReadError(pending, report.status)
  }
  // Not `Content-Encoding: gzip`: n8n would unpack it into a JSON body capped at 16 MiB. As a
  // gzip file, its webhook streams the body to disk without that cap.
  const body = await new Response(report.body.pipeThrough(new CompressionStream('gzip'))).blob()

  // Keeps a query string or fragment n8n may have put in the destination URL.
  const target = new URL(destination.url)
  target.searchParams.set('month', pending.month)

  let response: Response
  try {
    response = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/gzip',
        authorization: `Bearer ${destination.authToken}`,
      },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
  } catch (error) {
    // The browser does not say more: offline, DNS, a proxy and a blocked CORS request look alike.
    const reason =
      error instanceof DOMException && error.name === 'TimeoutError' ? 'timed out' : 'failed'
    throw new DestinationError(
      `Sending ${name} to n8n ${reason}. Check that this browser can open ${new URL(destination.url).origin}. ` +
        'The month stays pending, press Submit to retry.',
    )
  }

  // Not UnauthorizedError: that one is about the read token and would send the page back to its prompt.
  if (response.status === 401 || response.status === 403) {
    throw new DestinationError(
      `n8n rejected the destination auth token for ${name} (HTTP ${response.status}). ` +
        'Check N8N_MONITORING_REPORT_DESTINATION_AUTH_TOKEN on this service. The month stays pending.',
    )
  }

  // 409: n8n already has this month, e.g. its earlier answer never reached this browser.
  if (!response.ok && response.status !== 409) {
    throw new DestinationError(
      `n8n did not accept ${name} (HTTP ${response.status}). The month stays pending, press Submit to retry.`,
    )
  }

  const notRecorded = (reason: string) =>
    new Error(
      `n8n received ${name}, but this service could not record it (${reason}). Pressing Submit again is safe.`,
    )
  let recorded: Response
  try {
    recorded = await recordSubmission(pending.month)
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error
    }
    throw notRecorded('it could not be reached')
  }
  if (!recorded.ok) {
    throw notRecorded(`HTTP ${recorded.status}`)
  }
}
