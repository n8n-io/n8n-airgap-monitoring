import type { DataSource } from "@n8n/typeorm";
import type { InstanceReportRepository, InstanceReportRow } from "../instance-report/instance-report.repository";

// SPIKE (API-463): which finished months still have to go to n8n, and whether every instance
// has delivered them yet. Only advisory: the page sends the unchanged report either way.

const DAY_MS = 24 * 60 * 60 * 1000;
/** Silent for longer than this before the month started: decommissioned, not part of the month. */
const RECENTLY_ALIVE_MS = 30 * DAY_MS;
/** The next report is expected within this many of the instance's usual intervals. */
const CADENCE_TOLERANCE = 1.5;
/** The intervals the cadence is taken from. */
const CADENCE_SAMPLE = 10;
/**
 * A month becomes pending on this day of the next month (UTC), not at midnight on the 1st: the
 * last day's daily only arrives with each instance's report slot on the 1st.
 */
const PENDING_FROM_DAY = 2;

export interface Submission {
  month: string;
  submittedAt: string;
}

/** An instance that has not delivered the month's last day. */
export interface MissingInstance {
  instanceId: string;
  label: string | null;
  /** Last day of the month it has a daily value for, or null when it has none in the month. */
  lastDay: string | null;
  lastReportAt: string;
  /** Latest time its next report is due, from its own reporting cadence. */
  expectedBy: string;
}

export interface PendingMonth {
  month: string;
  start: string;
  end: string;
  instances: number;
  complete: number;
  /** The missing days most likely arrive with the instance's next report. */
  waiting: MissingInstance[];
  /** The missing days are not coming on their own: the report is overdue or already went past them. */
  stale: MissingInstance[];
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
  firstSeen: string;
  lastReportAt: string;
  cadenceMs: number;
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
      .filter((month) => isPending(month, now) && !done.has(month))
      .map((month) => checkMonth(month, instances, now));
    const upcoming = months.filter((month) => !isPending(month, now)).map((month) => upcomingMonth(month, instances));

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
    firstSeen: first.receivedAt,
    lastReportAt: last.receivedAt,
    cadenceMs: cadenceOf(rows),
    months,
    lastDailyByMonth,
  };
}

/** The median interval between its latest reports; a day when there are not two yet. */
function cadenceOf(rows: InstanceReportRow[]): number {
  const times = rows.slice(-(CADENCE_SAMPLE + 1)).map((row) => Date.parse(row.receivedAt));
  const gaps = times
    .slice(1)
    .map((time, index) => time - times[index])
    .sort((a, b) => a - b);

  return gaps.length === 0 ? DAY_MS : gaps[Math.floor(gaps.length / 2)];
}

function checkMonth(month: string, instances: InstanceSummary[], now: Date): PendingMonth {
  const { start, end } = monthBounds(month);
  const monthStart = Date.parse(`${start}T00:00:00.000Z`);
  const monthEnd = monthStart + daysIn(month) * DAY_MS;
  // A report covers the days up to the day before its slot, and is delivered at most a day after
  // its slot. Two days after the month's last day, a missing last day is not coming any more.
  const coveredBy = monthEnd + DAY_MS;

  const pendingMonth: PendingMonth = { month, start, end, instances: 0, complete: 0, waiting: [], stale: [] };

  for (const instance of instances) {
    const inMonth =
      instance.months.has(month) ||
      (Date.parse(instance.firstSeen) < monthEnd &&
        Date.parse(instance.lastReportAt) >= monthStart - RECENTLY_ALIVE_MS);
    if (!inMonth) {
      continue;
    }

    pendingMonth.instances += 1;
    const lastDay = instance.lastDailyByMonth.get(month) ?? null;
    if (lastDay === end) {
      pendingMonth.complete += 1;
      continue;
    }

    const lastReportAt = Date.parse(instance.lastReportAt);
    const expectedBy = lastReportAt + CADENCE_TOLERANCE * instance.cadenceMs;
    const missing: MissingInstance = {
      instanceId: instance.instanceId,
      label: instance.label,
      lastDay,
      lastReportAt: instance.lastReportAt,
      expectedBy: new Date(expectedBy).toISOString(),
    };

    if (lastReportAt < coveredBy && now.getTime() < expectedBy) {
      pendingMonth.waiting.push(missing);
    } else {
      pendingMonth.stale.push(missing);
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

export function isPending(month: string, now: Date): boolean {
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
