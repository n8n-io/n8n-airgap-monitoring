import type { UsageRepository } from "./usage.repository";

interface BaseMetric {
  name: string;
  value: number;
}

/**
 * A value covering one UTC calendar day, e.g. billable executions for
 * 2026-03-25. Day-scoped reporting limits the damage of a n8n instance DB
 * rollback to the affected days instead of corrupting a lifetime counter.
 */
interface DailyMetric extends BaseMetric {
  kind: "daily";
  /**
   * Generated on the reporting instance, unique per batch. Distinguishes a
   * retry of the same day (same batchId, drop the duplicate) from two
   * instances sharing an instanceId (different batchId, keep both).
   *
   * See https://app.notion.com/p/n8n/License-Server-Duplicated-Instances-2ed5b6e0c94f80338478cb53103dccff?source=copy_link#2f15b6e0c94f801a8657eabc7cc33112
   */
  batchId: string;
  /**
   * The UTC calendar day this value covers, as YYYY-MM-DD.
   *
   * Days are the only supported window, so one date replaces an explicit
   * range: there is no way to express a gap, an overlap, or a start after
   * its own end. Boundaries must be computed against UTC midnight.
   */
  date: string;
}

/** A running total maintained by the instance. Can regress after a customer DB rollback. */
interface CumulativeMetric extends BaseMetric {
  kind: "cumulative";
}

export type Metric = DailyMetric | CumulativeMetric;

export interface UsageReport {
  instanceId: string;
  /**
   * Display name only: instanceId stays the identity, so a relabel never
   * splits or merges an instance's history.
   */
  label?: string;
  n8nVersion: string;
  /**
   * Accepting an array here is useful for retries.
   * E.g. retrying Interval metrics after multiple days without successfuly report.
   */
  dataPoints: Metric[];
}

export class UsageService {
  constructor(private readonly repository: UsageRepository) {}

  recordReport(report: UsageReport): { id: number } {
    const id = this.repository.insert({
      ...report,
      receivedAt: new Date().toISOString(),
    });

    return { id };
  }
}
