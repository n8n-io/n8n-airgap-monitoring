import { secret } from './auth-state'
import type { InstanceSummary, MetricHistory } from './types'

const BASE_URL = import.meta.env.VITE_API_URL ?? ''

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`request failed with status ${status}`)
  }
}

/** Authenticates with the stored secret unless `token` overrides it. */
async function apiRequest(path: string, token: string = secret.value): Promise<Response> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new ApiError(response.status)
  }

  return response
}

async function apiFetch<T>(path: string): Promise<T> {
  const response = await apiRequest(path)

  return (await response.json()) as T
}

/**
 * Resolves if `secret` is a valid dashboard token, throws `ApiError(401)` otherwise.
 *
 * Takes the secret explicitly because it validates a login candidate that is
 * deliberately not stored yet.
 */
export async function checkAuth(secret: string): Promise<void> {
  await apiRequest('/api/v1/auth/check', secret)
}

export async function fetchInstanceReports(): Promise<{ instances: InstanceSummary[] }> {
  const { data } = await apiFetch<{ data: { instances: InstanceSummary[] } }>('/api/v1/instance-reports')

  return data
}

export async function fetchMetricHistory(instanceId: string, metricName: string): Promise<MetricHistory> {
  const path =
    `/api/v1/instance-reports/${encodeURIComponent(instanceId)}` +
    `/metrics/${encodeURIComponent(metricName)}/history`

  const { data } = await apiFetch<{ data: MetricHistory }>(path)

  return data
}
