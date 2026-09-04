import type { InstanceReportRepository, InstanceReportRow } from "./instance-report.repository";

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

/** A {@link ReportedMetric} still carrying the name it will be filed under, before grouping. */
interface NamedMetric {
  name: string;
  metric: ReportedMetric;
}

/** The report's view of one instance: identity, when we first heard from it, and its full metric history. */
export interface InstanceReportEntry {
  instanceId: string;
  /** Last-received display label, or null. Untrusted, customer-chosen free text. */
  label: string | null;
  /** UTC calendar day (YYYY-MM-DD) of the earliest event we stored for this instance. */
  firstSeen: string;
  /** Timestamp the collector received the most recent report from this instance. */
  lastReportAt: string;
  /**
   * Every value the instance ever reported, keyed by metric name. Nothing is folded or
   * deduplicated: this collector is a dumb pipe, so reconciliation (summing daily values,
   * detecting DB rollbacks or duplicated instances from conflicting values) is the
   * receiver's job — see the ADRs. One name can carry both kinds and repeated points.
   */
  dataPoints: Record<string, ReportedMetric[]>;
}

/**
 * The full downloadable usage report. Describes the wire format; nothing builds one
 * in a single piece, because holding every instance in memory at once is what
 * {@link InstanceReportService.reportStream} exists to avoid.
 */
export interface UsageReport {
  data: {
    /** When this report was generated, so a downloaded file is self-dating. */
    generatedAt: string;
    instances: InstanceReportEntry[];
  };
}

/** The report as a header plus a lazy sequence, so a caller can write it out as it is read. */
export interface ReportStream {
  /** When this report was generated, so a downloaded file is self-dating. */
  generatedAt: string;
  /** One entry per instance, produced on demand. Iterating it runs the queries. */
  entries: Generator<InstanceReportEntry>;
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
   * The report, read one instance at a time.
   *
   * A fleet reports for years, so the finished document runs to hundreds of megabytes.
   * Building it in one piece costs that much memory and blocks the event loop for as
   * long as it takes, which stalls the instances trying to report meanwhile. Yielding
   * per instance keeps only one instance's history alive at a time and lets the caller
   * hand each entry to the socket before asking for the next.
   */
  reportStream(): ReportStream {
    return {
      generatedAt: new Date().toISOString(),
      entries: this.entries(),
    };
  }

  private *entries(): Generator<InstanceReportEntry> {
    // Instances are read one at a time rather than under a single snapshot: the table
    // only grows, so a report arriving mid-download can add to the export but never
    // change what has already been written, and every point names the batch and moment
    // it arrived in anyway.
    for (const instanceId of this.repository.findInstanceIds()) {
      yield this.toEntry(this.repository.findByInstance(instanceId));
    }
  }

  /**
   * Rows belonging to one instance, oldest-first (repository order), so the first row is
   * its earliest and the last one carries its latest state. Never empty: an instance only
   * appears in `findInstanceIds` because it has rows, and rows are never deleted.
   */
  private toEntry(rows: InstanceReportRow[]): InstanceReportEntry {
    const first = rows[0];
    const last = rows[rows.length - 1];

    return {
      instanceId: first.instanceId,
      // Last-received label wins.
      label: last.label,
      // Slicing the ISO timestamp yields its UTC calendar day.
      firstSeen: first.receivedAt.slice(0, 10),
      lastReportAt: last.receivedAt,
      dataPoints: this.byName(rows.flatMap((row) => this.toNamedMetrics(row))),
    };
  }

  /**
   * Every point in one row, tagged with the metric name it is filed under.
   *
   * Each field is named rather than spread from the stored point. The `data` column is
   * parsed JSON, so its runtime contents are only as trustworthy as whatever wrote the
   * row; spreading would carry anything it happens to hold into the export, which no
   * longer validates its own output. Listing the fields keeps the response exactly
   * {@link ReportedMetric}, and `name` is dropped because it becomes the key.
   */
  private toNamedMetrics(row: InstanceReportRow): NamedMetric[] {
    return row.dataPoints.map((point) => ({
      name: point.name,
      metric:
        point.kind === "daily"
          ? { kind: "daily", date: point.date, value: point.value, batchId: row.batchId, receivedAt: row.receivedAt }
          : { kind: "cumulative", value: point.value, batchId: row.batchId, receivedAt: row.receivedAt },
    }));
  }

  /**
   * Nothing is folded or deduplicated here, only filed under its name.
   */
  private byName(points: NamedMetric[]): Record<string, ReportedMetric[]> {
    const grouped: Record<string, ReportedMetric[]> = Object.create(null);

    for (const { name, metric } of points) {
      if (grouped[name] === undefined) {
        grouped[name] = [];
      }
      grouped[name].push(metric);
    }

    return grouped;
  }
}
