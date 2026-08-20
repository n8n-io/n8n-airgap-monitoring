import {
  type CumulativeHistoryPoint,
  type DailyHistoryPoint,
  type DashboardRepository,
  type MetricSnapshot
} from './dashboard.repository'

export type MetricValue =
  | { kind: 'daily', value: number, date: string, receivedAt: string }
  | { kind: 'cumulative', value: number, receivedAt: string }

export interface InstanceListItem {
  instanceId: string
  label: string | null
  n8nVersion: string
  lastReceivedAt: string
  metrics: Record<string, MetricValue>
}

export interface InstanceListPage {
  instances: InstanceListItem[]
  metricNames: string[]
  nextCursor: number | null
}

export interface MetricHistory {
  kind: 'daily' | 'cumulative'
  points: DailyHistoryPoint[] | CumulativeHistoryPoint[]
}

export interface HistoryQuery {
  from: string | null
  to: string | null
  limit: number
}

function toMetricValue ({ metric, receivedAt }: MetricSnapshot): MetricValue {
  return metric.kind === 'daily'
    ? { kind: 'daily', value: metric.value, date: metric.date, receivedAt }
    : { kind: 'cumulative', value: metric.value, receivedAt }
}

export class DashboardService {
  constructor (private readonly repository: DashboardRepository) {}

  /**
   * A page of instances, most recently active first, each carrying the latest
   * value of every metric it has ever reported. Columns are page-scoped: a
   * metric that only appears on other pages isn't part of `metricNames` here.
   */
  listInstances (cursor: number | null, limit: number): InstanceListPage {
    const rows = this.repository.listInstancePage(cursor, limit + 1)
    const hasNextPage = rows.length > limit
    const page = hasNextPage ? rows.slice(0, limit) : rows
    const nextCursor = hasNextPage ? page[page.length - 1].latestId : null

    const envelopesById = new Map(
      this.repository.getEnvelopes(page.map((row) => row.latestId)).map((envelope) => [envelope.id, envelope])
    )

    const metricNames = new Set<string>()
    const instances = page.map((row) => {
      const envelope = envelopesById.get(row.latestId)!

      const metrics: Record<string, MetricValue> = {}
      for (const [name, snapshot] of this.repository.getLatestMetricsForInstance(row.instanceId)) {
        metricNames.add(name)
        metrics[name] = toMetricValue(snapshot)
      }

      return {
        instanceId: envelope.instanceId,
        label: envelope.label,
        n8nVersion: envelope.n8nVersion,
        lastReceivedAt: envelope.receivedAt,
        metrics
      }
    })

    return {
      instances,
      metricNames: [...metricNames].sort(),
      nextCursor
    }
  }

  /** `null` when this instance has never reported a metric by that name. */
  getMetricHistory (instanceId: string, metricName: string, query: HistoryQuery): MetricHistory | null {
    const kind = this.repository.getMetricKind(instanceId, metricName)
    if (kind === null) {
      return null
    }

    const points = kind === 'daily'
      ? this.repository.getDailyHistory(instanceId, metricName, query)
      : this.repository.getCumulativeHistory(instanceId, metricName, query)

    return { kind, points }
  }
}
