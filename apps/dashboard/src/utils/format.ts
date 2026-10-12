import type { Anomaly } from './report'

const LOCALE = 'en-GB'

const dayFormat = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const timestampFormat = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})
const numberFormat = new Intl.NumberFormat(LOCALE)
const deltaFormat = new Intl.NumberFormat(LOCALE, { signDisplay: 'exceptZero' })

/** A YYYY-MM-DD day, e.g. "20 Aug 2026". */
export function formatDay(day: string): string {
  return dayFormat.format(new Date(day))
}

/** In UTC, like every day boundary in the report. */
export function formatTimestamp(timestamp: string): string {
  return `${timestampFormat.format(new Date(timestamp))} UTC`
}

export function formatNumber(value: number): string {
  return numberFormat.format(value)
}

/** With its sign, e.g. "+81". */
export function formatDelta(value: number): string {
  return deltaFormat.format(value)
}

/** A few words for the tooltip of the value it is about. */
export function anomalyNote(anomaly: Anomaly): string {
  switch (anomaly.type) {
    case 'duplicate-day':
      return anomaly.batchIds.length > 1
        ? `${anomaly.count} values from ${anomaly.batchIds.length} batches`
        : `${anomaly.count} values in one batch`
    case 'cumulative-regression':
      return `dropped from ${formatNumber(anomaly.from)}`
    case 'cumulative-daily-mismatch': {
      const days =
        anomaly.fromDate === anomaly.toDate
          ? formatDay(anomaly.fromDate)
          : `${formatDay(anomaly.fromDate)} – ${formatDay(anomaly.toDate)}`
      return `grew ${formatNumber(anomaly.cumulativeDelta)} · dailies ${formatNumber(anomaly.dailySum)} (${days})`
    }
  }
}
