const DAY_MS = 24 * 60 * 60 * 1000

/** "September 2026" for "2026-09", in the viewer's language. */
export function formatMonth(month: string): string {
  const [year = 0, number = 1] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

/** "2 November 2026" for "2026-11-02", in the viewer's language. */
export function formatDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** In the viewer's time zone, which the browser names. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function daysSince(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / DAY_MS)
}
