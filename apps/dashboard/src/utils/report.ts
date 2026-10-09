// Mirrors UsageReport in apps/api/src/instance-report/instance-report.service.ts

interface PointBase {
  value: number
  batchId: string
  receivedAt: string
}

export interface DailyPoint extends PointBase {
  kind: 'daily'
  date: string
}

export interface CumulativePoint extends PointBase {
  kind: 'cumulative'
}

export type ReportedMetric = DailyPoint | CumulativePoint

export type MetricKind = ReportedMetric['kind']

export interface InstanceReportEntry {
  instanceId: string
  label: string | null
  firstSeen: string
  lastReportAt: string
  dataPoints: Record<string, ReportedMetric[]>
}

export interface UsageReport {
  data: {
    generatedAt: string
    airgapMonitoringVersion: string
    filters?: string
    instances: InstanceReportEntry[]
  }
}

export function isUsageReport(value: unknown): value is UsageReport {
  const data = (value as UsageReport | null)?.data

  return typeof data?.generatedAt === 'string' && Array.isArray(data.instances)
}

const DAY_MS = 86_400_000

/** The UTC calendar day of a timestamp, as YYYY-MM-DD. */
export function utcDay(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function addDays(day: string, days: number): string {
  return utcDay(new Date(Date.parse(day) + days * DAY_MS).toISOString())
}

/** Whole UTC calendar days from `from` to `to`, so yesterday is 1 regardless of the hour. */
export function utcDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(utcDay(to)) - Date.parse(utcDay(from))) / DAY_MS)
}

export type Status = 'active' | 'stale' | 'offline'

// Loose enough for an instance that reports once a week.
export const STALE_AFTER_DAYS = 14
export const OFFLINE_AFTER_DAYS = 30

/**
 * Measured against the report's generatedAt, not the viewer's clock: the file is a
 * snapshot, and opening it a week later must not turn every instance stale.
 */
export function statusOf(lastReportAt: string, generatedAt: string): Status {
  const days = utcDaysBetween(lastReportAt, generatedAt)

  if (days > OFFLINE_AFTER_DAYS) {
    return 'offline'
  }
  if (days > STALE_AFTER_DAYS) {
    return 'stale'
  }
  return 'active'
}

/** One table column. A name can be reported as both kinds, which then get a column each. */
export interface MetricColumn {
  name: string
  kind: MetricKind
}

export function columnKey(column: MetricColumn): string {
  return `${column.name}:${column.kind}`
}

export function metricColumns(instances: InstanceReportEntry[]): MetricColumn[] {
  const columns = new Map<string, MetricColumn>()

  for (const instance of instances) {
    for (const [name, points] of Object.entries(instance.dataPoints)) {
      for (const { kind } of points) {
        const column = { name, kind }
        columns.set(columnKey(column), column)
      }
    }
  }

  // Daily before cumulative: the total is checked against the dailies, not the other way round.
  const kindOrder = (kind: MetricKind) => (kind === 'daily' ? 0 : 1)
  return [...columns.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || kindOrder(a.kind) - kindOrder(b.kind),
  )
}

export function pointsOf(instance: InstanceReportEntry, column: MetricColumn): ReportedMetric[] {
  return (instance.dataPoints[column.name] ?? []).filter((point) => point.kind === column.kind)
}

/**
 * The value to show for a column: the last received total, or the daily of the newest date
 */
export function latestPoint(points: ReportedMetric[]): ReportedMetric | undefined {
  return [...points]
    .sort(
      (a, b) =>
        (a.kind === 'daily' && b.kind === 'daily' ? a.date.localeCompare(b.date) : 0) ||
        a.receivedAt.localeCompare(b.receivedAt),
    )
    .at(-1)
}

export type Anomaly =
  /**
   * A day reported more than once. The API rejects a repeated batchId, so a retry cannot do this:
   * in several batches it means two instances share an id, in one batch a bug in the reporter.
   */
  | { type: 'duplicate-day'; name: string; date: string; count: number; batchIds: string[] }
  /** A running total went down. */
  | { type: 'cumulative-regression'; name: string; from: number; to: number; receivedAt: string }
  /** The total grew by a different amount than the daily values over the same days add up to. */
  | {
      type: 'cumulative-daily-mismatch'
      name: string
      cumulativeDelta: number
      dailySum: number
      fromDate: string
      toDate: string
      /** When the total that ends the comparison arrived. */
      receivedAt: string
    }

export function findAnomalies(instance: InstanceReportEntry): Anomaly[] {
  return Object.entries(instance.dataPoints).flatMap(([name, points]) => {
    const dailies = points.filter((point): point is DailyPoint => point.kind === 'daily')
    const cumulatives = points.filter(
      (point): point is CumulativePoint => point.kind === 'cumulative',
    )

    return [
      ...duplicateDays(name, dailies),
      ...cumulativeRegressions(name, cumulatives),
      ...cumulativeDailyMismatch(name, points),
    ]
  })
}

function duplicateDays(name: string, dailies: DailyPoint[]): Anomaly[] {
  const batchesByDate = new Map<string, string[]>()
  for (const { date, batchId } of dailies) {
    batchesByDate.set(date, [...(batchesByDate.get(date) ?? []), batchId])
  }

  return [...batchesByDate]
    .filter(([, batchIds]) => batchIds.length > 1)
    .map(([date, batchIds]) => ({
      type: 'duplicate-day',
      name,
      date,
      count: batchIds.length,
      batchIds: [...new Set(batchIds)],
    }))
}

function cumulativeRegressions(name: string, cumulatives: CumulativePoint[]): Anomaly[] {
  return cumulatives.flatMap((point, i) => {
    const previous = cumulatives[i - 1]
    return previous !== undefined && point.value < previous.value
      ? [
          {
            type: 'cumulative-regression',
            name,
            from: previous.value,
            to: point.value,
            receivedAt: point.receivedAt,
          },
        ]
      : []
  })
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/** How much a batch's total grew since the batch before it, next to the dailies it carries. */
export interface BatchGrowth {
  /** The batch's total. */
  point: CumulativePoint
  growth: number
  /**
   * The days of the batch's dailies. n8n sends every day it has not reported yet, so these are
   * the days the growth covers, however late the batch was delivered.
   */
  days: string[]
  dailySum: number
  /**
   * A total is sampled when the batch is made and counts part of that day, which no daily
   * covers yet, while the total before it counted part of the batch's first day. So growth
   * and dailies may differ by up to a day's worth: the largest daily of those days.
   */
  tolerance: number
  /**
   * Whether the day the batch was made has a daily yet, from a later batch. Until then that
   * day's share of the growth is unknown, so the batch is not checked: the latest one never is.
   */
  checked: boolean
  mismatch: boolean
}

/** Per batch with a total and dailies, in receipt order; the first one has nothing to grow from. */
export function growthPerBatch(points: ReportedMetric[]): BatchGrowth[] {
  const dailyByDate = dailyValues(points)
  const batches = new Map<string, { total?: CumulativePoint; dailies: DailyPoint[] }>()
  for (const point of points) {
    const batch = batches.get(point.batchId) ?? { dailies: [] }
    if (point.kind === 'daily') {
      batch.dailies.push(point)
    } else {
      batch.total = point
    }
    batches.set(point.batchId, batch)
  }
  const withTotals = [...batches.values()]
    .flatMap(({ total, dailies }) => (total === undefined ? [] : [{ total, dailies }]))
    .sort((a, b) => a.total.receivedAt.localeCompare(b.total.receivedAt))

  return withTotals.flatMap(({ total, dailies }, i) => {
    const previous = withTotals[i - 1]
    const days = [...new Set(dailies.map(({ date }) => date))].sort()
    const newest = days[days.length - 1]
    if (previous === undefined || newest === undefined) {
      return []
    }

    const madeOn = addDays(newest, 1)
    const checked = dailyByDate.has(madeOn)
    const tolerance = Math.max(...[...days, madeOn].map((day) => dailyByDate.get(day) ?? 0))
    const growth = total.value - previous.total.value
    const dailySum = sum(dailies.map(({ value }) => value))
    return [
      {
        point: total,
        growth,
        days,
        dailySum,
        tolerance,
        checked,
        mismatch: checked && Math.abs(growth - dailySum) > tolerance,
      },
    ]
  })
}

/** Each checked batch whose total grew by more than a day beyond its dailies. */
function cumulativeDailyMismatch(name: string, points: ReportedMetric[]): Anomaly[] {
  return growthPerBatch(points)
    .filter(({ mismatch }) => mismatch)
    .map((batch) => ({
      type: 'cumulative-daily-mismatch',
      name,
      cumulativeDelta: batch.growth,
      dailySum: batch.dailySum,
      fromDate: batch.days[0] ?? '',
      toDate: batch.days[batch.days.length - 1] ?? '',
      receivedAt: batch.point.receivedAt,
    }))
}

/** Each day from `from` to `to`, both included; empty when `to` is before `from`. */
export function daysFrom(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push(day)
  }
  return days
}

/** One value per date. The latest receipt wins, so a duplicate batch is not counted twice. */
export function dailyValues(points: ReportedMetric[]): Map<string, number> {
  const values = new Map<string, number>()
  for (const point of points) {
    if (point.kind === 'daily') {
      values.set(point.date, point.value)
    }
  }
  return values
}

export function dailyMetricNames(instances: InstanceReportEntry[]): string[] {
  return [
    ...new Set(
      metricColumns(instances)
        .filter((column) => column.kind === 'daily')
        .map((column) => column.name),
    ),
  ]
}

/** A daily metric summed over instances, per date. */
export function sumDaily(instances: InstanceReportEntry[], name: string): Map<string, number> {
  const sums = new Map<string, number>()
  for (const instance of instances) {
    for (const [date, value] of dailyValues(instance.dataPoints[name] ?? [])) {
      sums.set(date, (sums.get(date) ?? 0) + value)
    }
  }
  return sums
}

/** A value in the raw data; a total also says how much it grew since the total before it. */
export interface RawValue {
  value: number
  delta?: number
}

/** One day of an instance's raw data, every value of each column on it. */
export interface RawRow {
  day: string
  /** By {@link columnKey}. More than one value on a day is worth a look. */
  values: Map<string, RawValue[]>
  /** When reports arrived on this day. */
  received: string[]
}

/**
 * Newest day first. A daily is filed under its date; a total has no date, so it is filed
 * under the day it was received.
 */
export function rawRows(instance: InstanceReportEntry): RawRow[] {
  const rows = new Map<string, RawRow>()
  const rowOf = (day: string): RawRow => {
    const row = rows.get(day) ?? { day, values: new Map(), received: [] }
    rows.set(day, row)
    return row
  }

  for (const [name, points] of Object.entries(instance.dataPoints)) {
    const totals = points
      .filter((point): point is CumulativePoint => point.kind === 'cumulative')
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    const deltas = new Map(
      totals.flatMap((point, i) => {
        const previous = totals[i - 1]
        return previous === undefined ? [] : [[point, point.value - previous.value] as const]
      }),
    )

    for (const point of points) {
      const values = rowOf(point.kind === 'daily' ? point.date : utcDay(point.receivedAt)).values
      const key = columnKey({ name, kind: point.kind })
      const entry =
        point.kind === 'daily'
          ? { value: point.value }
          : { value: point.value, delta: deltas.get(point) }
      values.set(key, [...(values.get(key) ?? []), entry])

      const { received } = rowOf(utcDay(point.receivedAt))
      if (!received.includes(point.receivedAt)) {
        received.push(point.receivedAt)
      }
    }
  }

  return [...rows.values()].sort((a, b) => b.day.localeCompare(a.day))
}

/**
 * The cell of the raw data each anomaly is about, keyed `day|columnKey`: a duplicate under
 * its daily, a total that dropped or does not match its dailies under the day it arrived.
 */
export function anomaliesByCell(anomalies: Anomaly[]): Map<string, Anomaly[]> {
  const cells = new Map<string, Anomaly[]>()
  for (const anomaly of anomalies) {
    const kind = anomaly.type === 'duplicate-day' ? 'daily' : 'cumulative'
    const key = `${anomalyDay(anomaly)}|${columnKey({ name: anomaly.name, kind })}`
    cells.set(key, [...(cells.get(key) ?? []), anomaly])
  }
  return cells
}

/** The day an anomaly is about: a repeated daily's date, or the day a total arrived. */
export function anomalyDay(anomaly: Anomaly): string {
  return anomaly.type === 'duplicate-day' ? anomaly.date : utcDay(anomaly.receivedAt)
}
