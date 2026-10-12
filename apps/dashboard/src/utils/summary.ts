import {
  type Anomaly,
  anomalyDay,
  findAnomalies,
  type InstanceReportEntry,
  type Status,
  statusOf,
  utcDaysBetween,
} from './report'

/** Everything the views derive from one instance, computed once per report. */
export interface InstanceSummary {
  instance: InstanceReportEntry
  status: Status
  daysSinceReport: number
  /** All of them, for the instance's own page. */
  anomalies: Anomaly[]
  /** Those of the last {@link RECENT_ANOMALY_DAYS} days, the ones the overview flags. */
  recentAnomalies: Anomaly[]
}

/**
 * Older anomalies were already seen at an earlier check. Reports are checked about monthly, so
 * two months still cover a check that was skipped or came late.
 */
export const RECENT_ANOMALY_DAYS = 60

export function summarize(
  instances: InstanceReportEntry[],
  generatedAt: string,
): InstanceSummary[] {
  return instances.map((instance) => {
    const anomalies = findAnomalies(instance)
    return {
      instance,
      status: statusOf(instance.lastReportAt, generatedAt),
      daysSinceReport: utcDaysBetween(instance.lastReportAt, generatedAt),
      anomalies,
      recentAnomalies: anomalies.filter(
        (anomaly) => utcDaysBetween(anomalyDay(anomaly), generatedAt) <= RECENT_ANOMALY_DAYS,
      ),
    }
  })
}

export type StatusFilter = Status | 'all' | 'anomaly'

export function displayName(instance: InstanceReportEntry): string {
  return instance.label ?? '(no label)'
}

/** Case-insensitive substring match on label or instanceId. */
export function matches(instance: InstanceReportEntry, term: string): boolean {
  const needle = term.trim().toLowerCase()
  return (
    needle === '' ||
    instance.instanceId.toLowerCase().includes(needle) ||
    (instance.label?.toLowerCase().includes(needle) ?? false)
  )
}
