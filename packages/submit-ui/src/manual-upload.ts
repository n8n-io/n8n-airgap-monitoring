import { authedFetch, type PendingMonth, reportReadError, reportUrl } from './api'

const REVOKE_DELAY_MS = 60 * 1000

/** The file name GET /api/v1/report sends, so a manual upload keeps the same name. */
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
