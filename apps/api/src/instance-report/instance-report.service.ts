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

/**
 * A reported value as it appears in the report: like {@link Metric} but carrying the
 * envelope's provenance and dropping `name` (that is the key it is filed under).
 */
interface ReportedMetricBase {
  value: number;
  /** batchId of the report that carried this point, so the receiver can join and dedup. */
  batchId: string;
  /** When the collector received the report this point arrived in. */
  receivedAt: string;
}

/** A day-scoped value in the report — {@link DailyMetric} plus provenance. */
interface ReportedDailyMetric extends ReportedMetricBase {
  kind: "daily";
  date: string;
}

/** A running total in the report — {@link CumulativeMetric} plus provenance. */
interface ReportedCumulativeMetric extends ReportedMetricBase {
  kind: "cumulative";
}

/** Kept as a discriminated union so a consumer can tell a day-scoped value from a running total. */
export type ReportedMetric = ReportedDailyMetric | ReportedCumulativeMetric;

/** The report's view of one instance: identity, when we first heard from it, and its full metric history. */
export interface InstanceReportEntry {
  instanceId: string;
  /** Last-received display label, or null. Untrusted, customer-chosen free text. */
  label: string | null;
  /** UTC calendar day (YYYY-MM-DD) of the earliest event we stored for this instance. */
  firstSeen: string;
  /**
   * Every value the instance ever reported, keyed by metric name. Nothing is folded or
   * deduplicated: this collector is a dumb pipe, so reconciliation (summing daily values,
   * detecting DB rollbacks or duplicated instances from conflicting values) is the
   * receiver's job — see the ADRs. One name can carry both kinds and repeated points.
   */
  dataPoints: Record<string, ReportedMetric[]>;
}

/** The full downloadable usage report, wrapped so error and success share a top-level object. */
export interface UsageReport {
  data: {
    /** When this report was generated, so a downloaded file is self-dating. */
    generatedAt: string;
    instances: InstanceReportEntry[];
  };
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

  /**
   * Projects the entire event store into the downloadable report. A faithful, lossless
   * pass over the log: it groups points by metric name but never folds, dedups or picks a
   * "latest" value. The latter matters most for cumulative metrics — with two instances
   * sharing an instanceId, "the latest number" is meaningless, and folding would also hide
   * DB rollbacks. Disentangling that is the receiver's job, so we hand over everything.
   */
  generateReport(): UsageReport {
    const instances = new Map<string, InstanceReportEntry>();

    // Rows arrive grouped per instance and oldest-first within each (repository order),
    // so the first row seen for an instance is its earliest, and the last wins for label.
    for (const row of this.repository.findAll()) {
      let entry = instances.get(row.instanceId);
      if (!entry) {
        entry = {
          instanceId: row.instanceId,
          label: row.label,
          // Slicing the ISO timestamp yields its UTC calendar day.
          firstSeen: row.receivedAt.slice(0, 10),
          dataPoints: {},
        };
        instances.set(row.instanceId, entry);
      }

      // Last-received label wins; a report that omits it clears a previously-set one.
      entry.label = row.label;

      for (const point of row.dataPoints) {
        const reported: ReportedMetric =
          point.kind === "daily"
            ? { kind: "daily", date: point.date, value: point.value, batchId: row.batchId, receivedAt: row.receivedAt }
            : { kind: "cumulative", value: point.value, batchId: row.batchId, receivedAt: row.receivedAt };

        const series = entry.dataPoints[point.name] ?? [];
        series.push(reported);
        entry.dataPoints[point.name] = series;
      }
    }

    return {
      data: {
        generatedAt: new Date().toISOString(),
        instances: [...instances.values()],
      },
    };
  }
}
