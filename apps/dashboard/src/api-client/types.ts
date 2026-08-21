export interface InstanceSummary {
  instanceId: string
  label: string | null
  n8nVersion: string
  receivedAt: string
  metrics: Record<string, number>
}

export interface DailyPoint {
  date: string
  value: number
  batchId: string
}

export interface CumulativePoint {
  receivedAt: string
  value: number
}

export type MetricHistory =
  { kind: 'daily'; points: DailyPoint[] } | { kind: 'cumulative'; points: CumulativePoint[] }
