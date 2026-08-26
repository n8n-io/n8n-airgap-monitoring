import type { InstanceReportRepository } from "./instance-report.repository";

interface BaseMetric {
  name: string;
  value: number; // TODO: (in a follow-up) think about how we can support any data type for values and yet still be able to generate nicely formed report downloads.
}

/**
 * A value covering one UTC calendar day, e.g. billable executions for
 * 2026-03-25. Day-scoped reporting limits the damage of a n8n instance DB
 * rollback to the affected days instead of corrupting a lifetime counter.
 */
interface DailyMetric extends BaseMetric {
  kind: "daily";
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

export interface CreateInstanceReport {
  instanceId: string;
  /**
   * Generated on the reporting instance, identifying this envelope. An
   * envelope is immutable once sent: a retry repeats it verbatim under the
   * same batchId, an accepted batchId is never sent again, and pending
   * envelopes are never merged, split or rebuilt.
   *
   * See adr/2026-08-26-report-envelopes-are-immutable.md and
   * https://app.notion.com/p/n8n/License-Server-Duplicated-Instances-2ed5b6e0c94f80338478cb53103dccff?source=copy_link#2f15b6e0c94f801a8657eabc7cc33112
   */
  batchId: string;
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

export class InstanceReportService {
  constructor(private readonly repository: InstanceReportRepository) {}

  recordReport(report: CreateInstanceReport): { id: number } {
    const id = this.repository.insert({
      ...report,
      receivedAt: new Date().toISOString(),
    });

    return { id };
  }
}
