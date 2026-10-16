/** Mirrors apps/api/src/submissions/submissions.service.ts. */
export interface MissingInstance {
  instanceId: string
  label: string | null
  lastDay: string | null
  lastReportAt: string
  expectedBy: string
}

export interface PendingMonth {
  month: string
  start: string
  end: string
  instances: number
  complete: number
  waiting: MissingInstance[]
  stale: MissingInstance[]
}

export interface Submission {
  month: string
  submittedAt: string
}

export interface UpcomingMonth {
  month: string
  start: string
  end: string
  pendingFrom: string
  instances: number
  collectedUpTo: string | null
}

export interface SubmissionsOverview {
  pending: PendingMonth[]
  upcoming: UpcomingMonth[]
  submitted: Submission[]
}

/** Where a month stands while Submit runs. */
export type SendState = 'sending' | 'sent' | 'failed'

/** One line of the page's month list. */
export type MonthRow =
  | { kind: 'upcoming'; month: string; upcoming: UpcomingMonth }
  | { kind: 'pending'; month: string; pending: PendingMonth }
  | { kind: 'submitted'; month: string; submittedAt: string }

export async function fetchOverview(): Promise<SubmissionsOverview> {
  const response = await fetch('/api/v1/submissions', { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Could not load the pending months (HTTP ${response.status}).`)
  }
  return (await response.json()) as SubmissionsOverview
}

/** The same report as GET /api/v1/report?start=…&end=…, served without the read token. */
export function reportUrl({ start, end }: PendingMonth): string {
  return `/api/v1/submissions/report?start=${start}&end=${end}`
}

export async function recordSubmission(month: string): Promise<Response> {
  return fetch(`/api/v1/submissions/${month}`, { method: 'POST' })
}
