import { formatMonth } from './format'

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

/** Where Submit sends the data, from the service's environment. Mirrors apps/api/src/plugins/config.ts. */
export interface ReportDestination {
  url: string
  authToken: string
}

export interface SubmissionsOverview {
  pending: PendingMonth[]
  upcoming: UpcomingMonth[]
  submitted: Submission[]
  /** Null when the service runs without N8N_MONITORING_REPORT_DESTINATION. */
  destination: ReportDestination | null
  /** The manual upload form. Mirrors apps/api/src/plugins/config.ts. Null: the page hides the link. */
  uploadFormUrl: string | null
}

/** Where a month stands while Submit runs. */
export type SendState = 'sending' | 'sent' | 'failed'

/** One line of the page's month list. */
export type MonthRow =
  | { kind: 'upcoming'; month: string; upcoming: UpcomingMonth }
  | { kind: 'pending'; month: string; pending: PendingMonth }
  | { kind: 'submitted'; month: string; submittedAt: string }

/** Thrown when the service rejects the read token, so the page can ask for it again. */
export class UnauthorizedError extends Error {
  constructor() {
    super('The read token was not accepted.')
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The read token, kept in memory only: every page load asks for it again. */
let token = ''

export function setToken(value: string): void {
  token = value.trim()
}

/** A request to this service with the read token. */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(url, { cache: 'no-store', ...init, headers })
  if (response.status === 401) {
    throw new UnauthorizedError()
  }
  return response
}

export async function fetchOverview(): Promise<SubmissionsOverview> {
  const response = await authedFetch('/api/v1/submissions')
  if (!response.ok) {
    throw new Error(`Could not load the pending months (HTTP ${response.status}).`)
  }
  return (await response.json()) as SubmissionsOverview
}

/** The month's usage report, exactly as GET /api/v1/report serves it. */
export function reportUrl({ start, end }: PendingMonth): string {
  return `/api/v1/report?start=${start}&end=${end}`
}

/** The error for a month whose report this service did not serve. */
export function reportReadError(pending: PendingMonth, status: number): Error {
  return new Error(
    `Could not read the usage data for ${formatMonth(pending.month)} from this service (HTTP ${status}).`,
  )
}

export async function recordSubmission(month: string): Promise<Response> {
  return authedFetch(`/api/v1/submissions/${month}`, { method: 'POST' })
}
