// Month spelled out (not numeric) so the date reads the same regardless of
// whether a country orders day/month or month/day.
const dateOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', dateOptions)

// UTC so a date-only value like '2026-03-25' (parsed as UTC midnight) doesn't
// shift back a day when rendered in timezones west of UTC.
const utcDateFormatter = new Intl.DateTimeFormat('en-GB', { ...dateOptions, timeZone: 'UTC' })

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  ...dateOptions,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Pass `includeTime: false` for a report whose metrics are all `daily`: those
 * values cover a whole UTC day, so an hour and minute would suggest a
 * precision the underlying data does not have.
 */
export function formatReceivedAt(receivedAt: string, includeTime = true): string {
  const date = new Date(receivedAt)
  if (Number.isNaN(date.getTime())) return receivedAt

  if (!includeTime) {
    return (DATE_ONLY.test(receivedAt) ? utcDateFormatter : dateFormatter).format(date)
  }

  return dateTimeFormatter.format(date)
}
