import { authedFetch, type PendingMonth, reportReadError, reportUrl } from './api'

const REVOKE_DELAY_MS = 60 * 1000

/**
 * Names the file by its month. The server's own name carries the generation time, so it differs
 * on every download and does not show which month the file holds.
 */
export function reportFileName(month: string): string {
  return `n8n-instance-report-${month}.json`
}

/** The month's report text, exactly as this service serves it. */
export async function fetchMonthReport(pending: PendingMonth): Promise<string> {
  const response = await authedFetch(reportUrl(pending))
  if (!response.ok) {
    throw reportReadError(pending, response.status)
  }
  return response.text()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The distinct license consumer IDs of a report's instances, in file order. */
export function consumerIdsIn(reportText: string): string[] {
  const report: unknown = JSON.parse(reportText)
  const data = isRecord(report) ? report.data : undefined
  const instances = isRecord(data) ? data.instances : undefined
  if (!Array.isArray(instances)) {
    return []
  }

  const consumerIds = new Set<string>()
  for (const instance of instances) {
    const ids = isRecord(instance) ? instance.consumerIds : undefined
    if (!Array.isArray(ids)) {
      continue
    }
    for (const id of ids) {
      if (typeof id === 'string') {
        consumerIds.add(id)
      }
    }
  }
  return [...consumerIds]
}

/**
 * The upload form fills a field from the query parameter that has the field's name. These names
 * must match the field names in n8n's form.
 */
const MONTH_FIELD = 'month'
const CONSUMER_ID_FIELD = 'consumerId'

/**
 * The upload form with the month and consumer ID already filled in. With no ID, or several, the
 * ID is left out, so a value in the configured URL does not reach the form.
 */
export function prefilledFormUrl(formUrl: string, month: string, consumerIds: string[]): string {
  const url = new URL(formUrl)
  url.searchParams.set(MONTH_FIELD, month)
  url.searchParams.delete(CONSUMER_ID_FIELD)
  const [consumerId, ...otherIds] = consumerIds
  if (consumerId !== undefined && otherIds.length === 0) {
    url.searchParams.set(CONSUMER_ID_FIELD, consumerId)
  }
  return url.href
}

/** Saves text as a JSON file through a temporary download link. */
export function saveFile(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  // Some browsers read the URL after the click returns, and a large report can take a while to start.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
