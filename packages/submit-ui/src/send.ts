import { authedFetch, type PendingMonth, type ReportDestination, recordSubmission, reportUrl } from './api'
import { formatMonth } from './format'

/** Generous: a large fleet's month is megabytes even gzipped, and office uplinks are slow. */
const SEND_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Sends one month to n8n exactly as this service reports it: the report stream is gzipped on its
 * way through and never parsed or changed, so the tab holds only the compressed bytes.
 */
export async function sendMonth(pending: PendingMonth, destination: ReportDestination): Promise<void> {
  const name = formatMonth(pending.month)

  const report = await authedFetch(reportUrl(pending))
  if (!report.ok || report.body === null) {
    throw new Error(`Could not read the usage data for ${name} from this service (HTTP ${report.status}).`)
  }
  // Not `Content-Encoding: gzip`: n8n would unpack it into a JSON body capped at 16 MiB. As a
  // gzip file, its webhook streams the body to disk without that cap.
  const body = await new Response(report.body.pipeThrough(new CompressionStream('gzip'))).blob()

  let response: Response
  try {
    response = await fetch(`${destination.url}?month=${pending.month}`, {
      method: 'POST',
      headers: { 'content-type': 'application/gzip', authorization: `Bearer ${destination.authToken}` },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
  } catch (error) {
    // The browser does not say more: offline, DNS, a proxy and a blocked CORS request look alike.
    const reason = error instanceof DOMException && error.name === 'TimeoutError' ? 'timed out' : 'failed'
    throw new Error(
      `Sending ${name} to n8n ${reason}. Check that this browser can open ${new URL(destination.url).origin}. ` +
        'The month stays pending, press Submit to retry.',
    )
  }

  // Not UnauthorizedError: that one is about the read token and would send the page back to its prompt.
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `n8n rejected the destination auth token for ${name} (HTTP ${response.status}). ` +
        'Check N8N_MONITORING_REPORT_DESTINATION_AUTH_TOKEN on this service. The month stays pending.',
    )
  }

  // 409: n8n already has this month, e.g. its earlier answer never reached this browser.
  if (!response.ok && response.status !== 409) {
    throw new Error(`n8n did not accept ${name} (HTTP ${response.status}). The month stays pending, press Submit to retry.`)
  }

  const recorded = await recordSubmission(pending.month)
  if (!recorded.ok) {
    throw new Error(
      `n8n received ${name}, but this service could not record it (HTTP ${recorded.status}). Pressing Submit again is safe.`,
    )
  }
}
