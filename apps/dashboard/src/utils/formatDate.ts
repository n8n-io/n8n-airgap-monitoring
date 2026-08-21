// Month spelled out (not numeric) so the date reads the same regardless of
// whether a country orders day/month or month/day.
const dateOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', dateOptions)

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  ...dateOptions,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/**
 * Pass `includeTime: false` for a report whose metrics are all `daily`: those
 * values cover a whole UTC day, so an hour and minute would suggest a
 * precision the underlying data does not have.
 */
export function formatReceivedAt(receivedAt: string, includeTime = true): string {
  const date = new Date(receivedAt)
  const formatter = includeTime ? dateTimeFormatter : dateFormatter

  return Number.isNaN(date.getTime()) ? receivedAt : formatter.format(date)
}
