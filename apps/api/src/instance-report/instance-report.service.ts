import type { InstanceReportRepository, InstanceReportRow } from "./instance-report.repository";
import { sanitizeLabel } from "./label";

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
   * splits or merges an instance's history. Sanitized to a URL-compliant
   * label before it is stored, see {@link sanitizeLabel}.
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
  /**
   * Last-received display label, or null. Customer-chosen and URL-compliant,
   * except from rows stored before labels were sanitized.
   */
  label: string | null;
  /** Timestamp the collector received the earliest event we stored for this instance. */
  firstSeen: string;
  /** Timestamp the collector received the most recent report from this instance. */
  lastReportAt: string;
  /**
   * Sorted distinct license consumer ids on reports this instance sent whose
   * `receivedAt` falls in the download window. Empty when those reports had no
   * certificate. Several ids mean this instance authenticated with more than one license.
   */
  consumerIds: string[];
  /**
   * Every value the instance ever reported, keyed by metric name. Nothing is folded or
   * deduplicated: reconciliation (summing daily values, detecting DB rollbacks or
   * duplicated instances from conflicting values) is the receiver's job — see the ADRs.
   * One name can carry both kinds and repeated points.
   */
  dataPoints: Record<string, ReportedMetric[]>;
}

/** The full downloadable usage report, wrapped so error and success share a top-level object. */
export interface UsageReport {
  data: {
    /** When this report was generated, so a downloaded file is self-dating. */
    generatedAt: string;
    /** Version of the n8n-airgap-monitoring service that generated this report. */
    airgapMonitoringVersion: string;
    /** Filters applied to this report as a query string (e.g. `instanceId=a,b`). Absent when none. */
    filters?: string;
    /**
     * Sorted distinct license consumer ids of rows in this download.
     * Empty when every matching row was stored without a certificate.
     */
    consumerIds: string[];
    instances: InstanceReportEntry[];
  };
}

export interface ReportFilter {
  instanceIds?: string[];
  start?: string;
  end?: string;
}

/** One download, read from a single snapshot. Draining `instances` closes that snapshot. */
export interface InstanceReportDownload {
  consumerIds: string[];
  instances: AsyncGenerator<InstanceReportEntry>;
}

interface InstanceRows {
  findByInstanceId(instanceId: string): Promise<InstanceReportRow[]>;
}

export class InstanceReportService {
  constructor(private readonly repository: InstanceReportRepository) {}

  async recordReport(report: CreateInstanceReport, consumerId: string | null): Promise<{ id: number }> {
    const label = report.label ? sanitizeLabel(report.label) : undefined;

    const id = await this.repository.insert({
      ...report,
      label,
      consumerId,
      receivedAt: new Date().toISOString(),
    });

    return { id };
  }

  /**
   * The report's instances, one at a time, ready to be streamed straight to the
   * response. Only a single instance's history is materialised at any moment, so
   * memory consumption does not depends on instance amounts.
   *
   * Rows come back grouped per instance and oldest-first (repository order), so
   * the first row is the earliest and the last carries the latest state — see
   * {@link toEntry}.
   */
  async *streamInstanceReports(filter: ReportFilter = {}): AsyncGenerator<InstanceReportEntry> {
    const instanceIds = await this.repository.findInstanceIds(filter.instanceIds);
    yield* iterateInstances(this.repository, instanceIds, filter);
  }

  /**
   * Top-level consumer ids and instance entries from one snapshot. A report
   * ingested while the download streams stays out of both. The caller drains
   * `instances`, or calls `return`, which closes the snapshot.
   */
  async openDownload(filter: ReportFilter = {}): Promise<InstanceReportDownload> {
    const snapshot = await this.repository.openReadSnapshot();
    try {
      const consumerIds = await snapshot.findConsumerIds(filter);
      const instanceIds = await snapshot.findInstanceIds(filter.instanceIds);
      const instances = iterateInstances(snapshot, instanceIds, filter, () => snapshot.close());
      return { consumerIds, instances };
    } catch (error) {
      await snapshot.close();
      throw error;
    }
  }
}

async function* iterateInstances(
  reader: InstanceRows,
  instanceIds: string[],
  filter: ReportFilter,
  close?: () => Promise<void>,
): AsyncGenerator<InstanceReportEntry> {
  try {
    for (const instanceId of instanceIds) {
      const rows = await reader.findByInstanceId(instanceId);
      const entry = toEntry(rows, filter);
      if (entry !== undefined) {
        yield entry;
      }
    }
  } finally {
    if (close !== undefined) {
      await close();
    }
  }
}

/**
 * One instance's rows, oldest-first (repository order) and never empty, so the
 * first row is its earliest and the last carries its latest state.
 * Only the points are narrowed to the filter's days.
 */
function toEntry(rows: InstanceReportRow[], filter: ReportFilter): InstanceReportEntry | undefined {
  const points = rows.flatMap(toNamedMetrics).filter(({ metric }) => isInDays(metric, filter));
  if (points.length === 0) {
    return undefined;
  }

  const first = rows[0];
  const last = rows[rows.length - 1];

  return {
    instanceId: first.instanceId,
    label: last.label, // last-received label wins
    firstSeen: first.receivedAt,
    lastReportAt: last.receivedAt,
    consumerIds: consumerIdsOf(rows, filter),
    dataPoints: byName(points),
  };
}

/**
 * Distinct ids of rows received inside the window. The id belongs to the
 * envelope, so a daily point dated inside the window does not carry an id
 * from a report received outside it.
 */
function consumerIdsOf(rows: InstanceReportRow[], filter: ReportFilter): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.consumerId !== null && isDayInRange(row.receivedAt.slice(0, 10), filter)) {
      ids.add(row.consumerId);
    }
  }
  return [...ids].sort();
}

/** A daily value counts towards its date, a cumulative total towards the UTC day it was received. */
function isInDays(metric: ReportedMetric, filter: ReportFilter): boolean {
  const day = metric.kind === "daily" ? metric.date : metric.receivedAt.slice(0, 10);
  return isDayInRange(day, filter);
}

/** YYYY-MM-DD strings compare in calendar order. */
function isDayInRange(day: string, { start, end }: ReportFilter): boolean {
  return (start === undefined || day >= start) && (end === undefined || day <= end);
}

/** Every point in one row, tagged with the metric name it is filed under. */
function toNamedMetrics(row: InstanceReportRow): NamedMetric[] {
  return row.dataPoints.map(({ name, ...point }) => ({
    name,
    metric: { ...point, batchId: row.batchId, receivedAt: row.receivedAt },
  }));
}

/** Files each point under its name. Nothing is folded or deduplicated. */
function byName(points: NamedMetric[]): Record<string, ReportedMetric[]> {
  const grouped: Record<string, ReportedMetric[]> = Object.create(null);

  for (const { name, metric } of points) {
    if (grouped[name] === undefined) {
      grouped[name] = [];
    }
    grouped[name].push(metric);
  }

  return grouped;
}
