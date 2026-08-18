import { type UsageRepository } from './usage.repository'

interface BaseMetric {
  name: string
  value: number
}

/**
 * A value scoped to one reporting window, e.g. billable executions per day.
 * Windowed reporting limits the damage of a customer DB rollback to the
 * affected days instead of corrupting a lifetime counter.
 */
interface IntervalMetric extends BaseMetric {
  kind: 'interval'
  /**
   * Generated on the reporting instance, unique per batch. Distinguishes a
   * retry of the same window (same batchId, drop the duplicate) from two
   * instances sharing an instanceId (different batchId, keep both).
   *
   * See https://app.notion.com/p/n8n/License-Server-Duplicated-Instances-2ed5b6e0c94f80338478cb53103dccff?source=copy_link#2f15b6e0c94f801a8657eabc7cc33112
   */
  batchId: string
  /**
   * Window start, inclusive. ISO string in UTC, e.g. 2026-03-25T00:00:00.000Z
   */
  start: string
  /**
   * Window end, exclusive: the instant the next window starts, e.g.
   * 2026-03-26T00:00:00.000Z for a window covering 2026-03-25.
   */
  end: string
}

/** A running total maintained by the instance. Can regress after a customer DB rollback. */
interface CumulativeMetric extends BaseMetric {
  kind: 'cumulative'
}

export type Metric = IntervalMetric | CumulativeMetric

export interface UsageReport {
  instanceId: string
  /**
   * Display name only: instanceId stays the identity, so a relabel never
   * splits or merges an instance's history.
   */
  label?: string
  n8nVersion: string
  /**
   * Accepting an array here is useful for retries.
   * E.g. retrying Interval metrics after multiple days without successfuly report.
   */
  dataPoints: Metric[]
}

export class UsageService {
  constructor (private readonly repository: UsageRepository) {}


  recordReport (report: UsageReport): { id: number } {
    const id = this.repository.insert({
      ...report,
      receivedAt: new Date().toISOString()
    })

    return { id }
  }
}
