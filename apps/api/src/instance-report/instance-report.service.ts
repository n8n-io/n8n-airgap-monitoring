import type { InstanceReportRepository } from "./instance-report.repository";

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

export interface CreateInstanceReport {
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

/** Current, dashboard-facing view of one instance, folded from its full report history. */
export interface InstanceSummary {
  instanceId: string;
  label: string | null;
  n8nVersion: string;
  receivedAt: string;
  metrics: Record<string, number>;
}

export interface DailyPoint {
  date: string;
  value: number;
  batchId: string;
}

export interface CumulativePoint {
  receivedAt: string;
  value: number;
}

export type MetricHistory = { kind: "daily"; points: DailyPoint[] } | { kind: "cumulative"; points: CumulativePoint[] };

export class InstanceReportService {
  constructor(private readonly repository: InstanceReportRepository) {}

  recordReport(report: CreateInstanceReport): { id: number } {
    const id = this.repository.insert({
      ...report,
      receivedAt: new Date().toISOString(),
    });

    return { id };
  }

  /**
   * One summary per instance, folded from its entire report history: a retry
   * can resend just one metric name, so only reading the latest report would
   * silently drop every other metric that instance has ever reported.
   */
  listInstances(): InstanceSummary[] {
    const summaries = new Map<string, InstanceSummary>();

    for (const row of this.repository.findAll()) {
      let summary = summaries.get(row.instanceId);
      if (!summary) {
        summary = {
          instanceId: row.instanceId,
          label: null,
          n8nVersion: row.n8nVersion,
          receivedAt: row.receivedAt,
          metrics: {},
        };
        summaries.set(row.instanceId, summary);
      }

      // Last-write-wins by receipt order (rows arrive oldest-first per
      // instance here), not by numeric value: a cumulative metric can
      // legitimately regress, and this must reflect the most recently
      // received report regardless of kind. A report that omits `label`
      // clears a previously-set one, for the same reason.
      summary.label = row.label;
      summary.n8nVersion = row.n8nVersion;
      summary.receivedAt = row.receivedAt;

      for (const point of row.dataPoints) {
        // Applies uniformly to `daily` metrics too, so a resent earlier day
        // arriving after a later day's report will incorrectly win. Known
        // limitation: reconciling daily metrics by `date` instead of receipt
        // order is not handled yet.
        summary.metrics[point.name] = point.value;
      }
    }

    // Rows are globally ordered instance_id ASC, so Map insertion order
    // already matches; no separate sort needed.
    return [...summaries.values()];
  }

  /**
   * Full history of one metric on one instance, or `null` if that instance
   * never reported it.
   *
   * The kind is decided by the most recently received matching point, mirroring
   * the last-write-wins rule in `listInstances`. Points of the other kind are
   * dropped rather than coerced, in the unlikely case a metric name switched
   * kind mid-history — the two shapes aren't interchangeable.
   */
  getMetricHistory(instanceId: string, metricName: string): MetricHistory | null {
    let kind: Metric["kind"] | null = null;
    const dailyByBatchId = new Map<string, DailyPoint>();
    const cumulativeByReceivedAt = new Map<string, CumulativePoint>();

    for (const row of this.repository.findByInstanceId(instanceId)) {
      for (const point of row.dataPoints) {
        if (point.name !== metricName) {
          continue;
        }

        kind = point.kind;

        if (point.kind === "daily") {
          // Last occurrence of a batchId wins: a retry resends the same
          // batchId, while two instances sharing an instanceId send
          // different ones, so both survive.
          dailyByBatchId.set(point.batchId, { date: point.date, value: point.value, batchId: point.batchId });
        } else {
          // Keyed by receivedAt, matching how the dashboard panel keys its
          // rows; a same-millisecond burst collapses to the last value.
          cumulativeByReceivedAt.set(row.receivedAt, { receivedAt: row.receivedAt, value: point.value });
        }
      }
    }

    if (kind === null) {
      return null;
    }

    if (kind === "daily") {
      const points = [...dailyByBatchId.values()].sort((a, b) => a.date.localeCompare(b.date));
      return { kind, points };
    }

    return { kind, points: [...cumulativeByReceivedAt.values()] };
  }
}
