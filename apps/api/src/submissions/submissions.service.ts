import type { DataSource } from "@n8n/typeorm";
import type { InstanceReportRepository, InstanceReportRow } from "../instance-report/instance-report.repository";

/**
 * A month becomes pending on this day of the next month (UTC), not at midnight on the 1st: the
 * last day's daily only arrives with each instance's report slot on the 1st.
 */
const PENDING_FROM_DAY = 2;

export interface Submission {
  month: string;
  submittedAt: string;
}

/** An instance with data in the month that has not delivered the month's last day. */
export interface MissingInstance {
  instanceId: string;
  label: string | null;
  /** Last day of the month it has a daily value for, or null when it only has totals in the month. */
  lastDay: string | null;
}

export interface PendingMonth {
  month: string;
  start: string;
  end: string;
  instances: number;
  complete: number;
  missing: MissingInstance[];
}

/** A month with data that cannot be submitted yet. */
export interface UpcomingMonth {
  month: string;
  start: string;
  end: string;
  /** The UTC day it becomes pending. */
  pendingFrom: string;
  instances: number;
  /** The latest day any instance has delivered so far, or null when none has. */
  collectedUpTo: string | null;
}

export interface SubmissionsOverview {
  /** Oldest first, the order the page sends them in. */
  pending: PendingMonth[];
  /** Oldest first: the month in progress, and on the 1st also the one that just ended. */
  upcoming: UpcomingMonth[];
  /** Newest month first. */
  submitted: Submission[];
}

/** One instance, condensed to what the month checks need. */
interface InstanceSummary {
  instanceId: string;
  label: string | null;
  firstDay: string;
  /** Months it has any point in, by the report filter's day rule. */
  months: Set<string>;
  /** Its last daily date in each month. */
  lastDailyByMonth: Map<string, string>;
}

export class SubmissionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reports: InstanceReportRepository,
  ) {}

  async overview(now = new Date()): Promise<SubmissionsOverview> {
    const submitted = await this.findSubmitted();
    const done = new Set(submitted.map(({ month }) => month));

    // One instance's history at a time, like the report stream; only the summary is kept.
    const instances: InstanceSummary[] = [];
    for (const instanceId of await this.reports.findInstanceIds()) {
      instances.push(summarize(await this.reports.findByInstanceId(instanceId)));
    }

    const firstDay = instances.map((instance) => instance.firstDay).sort()[0];
    if (firstDay === undefined) {
      return { pending: [], upcoming: [], submitted };
    }

    const months = monthsSince(firstDay.slice(0, 7), now);
    const pending = months
      .filter((month) => isClosed(month, now) && !done.has(month))
      .map((month) => checkMonth(month, instances));
    const upcoming = months.filter((month) => !isClosed(month, now)).map((month) => upcomingMonth(month, instances));

    return { pending, upcoming, submitted };
  }

  async record(month: string, now = new Date()): Promise<void> {
    // The first acknowledgement wins, so a second tab cannot move the timestamp.
    await this.dataSource.query("INSERT OR IGNORE INTO report_submissions (month, submittedAt) VALUES (?, ?)", [
      month,
      now.toISOString(),
    ]);
  }

  private async findSubmitted(): Promise<Submission[]> {
    return this.dataSource.query("SELECT month, submittedAt FROM report_submissions ORDER BY month DESC");
  }
}

/** Rows come oldest-first and never empty (repository order). */
function summarize(rows: InstanceReportRow[]): InstanceSummary {
  const months = new Set<string>();
  const lastDailyByMonth = new Map<string, string>();
  let firstDay: string | undefined;

  for (const row of rows) {
    for (const point of row.dataPoints) {
      // Same rule as the report's start/end filter: a daily by its date, a total by its arrival day.
      const day = point.kind === "daily" ? point.date : row.receivedAt.slice(0, 10);
      const month = day.slice(0, 7);
      months.add(month);
      if (firstDay === undefined || day < firstDay) {
        firstDay = day;
      }
      if (point.kind === "daily" && day > (lastDailyByMonth.get(month) ?? "")) {
        lastDailyByMonth.set(month, day);
      }
    }
  }

  const first = rows[0];
  const last = rows[rows.length - 1];

  return {
    instanceId: first.instanceId,
    label: last.label,
    firstDay: firstDay ?? first.receivedAt.slice(0, 10),
    months,
    lastDailyByMonth,
  };
}

/**
 * Instances report daily, so by the time a month is pending every instance still running has
 * delivered its last day. One that has not usually stopped during the month, e.g. was decommissioned.
 */
function checkMonth(month: string, instances: InstanceSummary[]): PendingMonth {
  const { start, end } = monthBounds(month);
  const pendingMonth: PendingMonth = { month, start, end, instances: 0, complete: 0, missing: [] };

  for (const instance of instances.filter(({ months }) => months.has(month))) {
    pendingMonth.instances += 1;
    const lastDay = instance.lastDailyByMonth.get(month) ?? null;
    if (lastDay === end) {
      pendingMonth.complete += 1;
    } else {
      pendingMonth.missing.push({ instanceId: instance.instanceId, label: instance.label, lastDay });
    }
  }

  return pendingMonth;
}

function upcomingMonth(month: string, instances: InstanceSummary[]): UpcomingMonth {
  const inMonth = instances.filter((instance) => instance.months.has(month));
  const collectedUpTo =
    inMonth
      .map((instance) => instance.lastDailyByMonth.get(month))
      .filter((day) => day !== undefined)
      .sort()
      .at(-1) ?? null;

  return { month, ...monthBounds(month), pendingFrom: pendingFrom(month), instances: inMonth.length, collectedUpTo };
}

/** Every month from `first` up to and including the current UTC month. */
function monthsSince(first: string, now: Date): string[] {
  const current = now.toISOString().slice(0, 7);
  const months: string[] = [];
  for (let month = first; month <= current; month = nextMonth(month)) {
    months.push(month);
  }
  return months;
}

export function pendingFrom(month: string): string {
  return `${nextMonth(month)}-${String(PENDING_FROM_DAY).padStart(2, "0")}`;
}

/** Whether the month has ended (from pendingFrom on), by the clock alone: not whether it was submitted or has data. */
export function isClosed(month: string, now: Date): boolean {
  return now.getTime() >= Date.parse(`${pendingFrom(month)}T00:00:00.000Z`);
}

function nextMonth(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
}

function daysIn(month: string): number {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

export function monthBounds(month: string): { start: string; end: string } {
  return { start: `${month}-01`, end: `${month}-${String(daysIn(month)).padStart(2, "0")}` };
}
