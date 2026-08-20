import type Database from 'better-sqlite3'
import type { Metric } from '../usage/usage.service'

/** One instance's most recent event id, used to page and then fetch its envelope. */
export interface InstancePageRow {
  instanceId: string
  latestId: number
}

export interface InstanceEnvelope {
  id: number
  instanceId: string
  label: string | null
  n8nVersion: string
  receivedAt: string
}

export interface MetricSnapshot {
  metric: Metric
  receivedAt: string
}

interface HistoryOptions {
  from: string | null
  to: string | null
  limit: number
}

export interface DailyHistoryPoint {
  date: string
  value: number
  batchId: string
  receivedAt: string
}

export interface CumulativeHistoryPoint {
  value: number
  receivedAt: string
}

/**
 * Read-only data access over the append-only usage event store. Holds no
 * business rules: callers decide what a page/history window means, this only
 * decides how to fetch it.
 */
export class DashboardRepository {
  readonly #firstInstancePage: Database.Statement
  readonly #instancePageAfterCursor: Database.Statement
  readonly #envelopesForIds: Database.Statement
  readonly #metricRowsForInstance: Database.Statement
  readonly #metricKind: Database.Statement
  readonly #dailyHistory: Database.Statement
  readonly #cumulativeHistory: Database.Statement

  constructor (db: Database.Database) {
    // Keyset pagination on `id`: unique and monotonic (single-writer process),
    // so no tie-break is needed and a page fetch can't skip/duplicate an
    // instance while /ingest keeps appending rows concurrently.
    this.#firstInstancePage = db.prepare(`
      SELECT instance_id AS instanceId, MAX(id) AS latestId
      FROM usage_events
      GROUP BY instance_id
      ORDER BY latestId DESC
      LIMIT ?
    `)

    this.#instancePageAfterCursor = db.prepare(`
      SELECT instance_id AS instanceId, MAX(id) AS latestId
      FROM usage_events
      GROUP BY instance_id
      HAVING MAX(id) < ?
      ORDER BY latestId DESC
      LIMIT ?
    `)

    // The id list has no fixed arity, so it's passed as one JSON-array
    // parameter instead of building a `?, ?, ...` placeholder string per call.
    this.#envelopesForIds = db.prepare(`
      SELECT id, instance_id AS instanceId, label, n8n_version AS n8nVersion, received_at AS receivedAt
      FROM usage_events
      WHERE id IN (SELECT value FROM json_each(?))
    `)

    // Indexed seek on idx_usage_events_instance; rows come back newest first
    // so the caller can dedup to "latest value per metric name" in one pass.
    this.#metricRowsForInstance = db.prepare(`
      SELECT je.value AS metricJson, ue.received_at AS receivedAt
      FROM usage_events ue, json_each(ue.data) je
      WHERE ue.instance_id = ?
      ORDER BY ue.received_at DESC, ue.id DESC
    `)

    this.#metricKind = db.prepare(`
      SELECT je.value ->> 'kind' AS kind
      FROM usage_events ue, json_each(ue.data) je
      WHERE ue.instance_id = ? AND je.value ->> 'name' = ?
      LIMIT 1
    `)

    this.#dailyHistory = db.prepare(`
      SELECT je.value ->> 'date'    AS date,
             je.value ->> 'value'   AS value,
             je.value ->> 'batchId' AS batchId,
             ue.received_at         AS receivedAt
      FROM usage_events ue, json_each(ue.data) je
      WHERE ue.instance_id = @instanceId
        AND je.value ->> 'name' = @metricName
        AND je.value ->> 'kind' = 'daily'
        AND (@from IS NULL OR je.value ->> 'date' >= @from)
        AND (@to   IS NULL OR je.value ->> 'date' <= @to)
      ORDER BY date ASC, receivedAt ASC
      LIMIT @limit
    `)

    // Cumulative metrics have no `date` field, so their series is keyed by
    // arrival time instead.
    this.#cumulativeHistory = db.prepare(`
      SELECT je.value ->> 'value' AS value,
             ue.received_at       AS receivedAt
      FROM usage_events ue, json_each(ue.data) je
      WHERE ue.instance_id = @instanceId
        AND je.value ->> 'name' = @metricName
        AND je.value ->> 'kind' = 'cumulative'
        AND (@from IS NULL OR ue.received_at >= @from)
        AND (@to   IS NULL OR ue.received_at <= @to)
      ORDER BY receivedAt ASC
      LIMIT @limit
    `)
  }

  /** Up to `fetchCount` instances, most recently active first. */
  listInstancePage (cursor: number | null, fetchCount: number): InstancePageRow[] {
    const rows = cursor === null
      ? this.#firstInstancePage.all(fetchCount)
      : this.#instancePageAfterCursor.all(cursor, fetchCount)

    return rows as InstancePageRow[]
  }

  getEnvelopes (ids: number[]): InstanceEnvelope[] {
    return this.#envelopesForIds.all(JSON.stringify(ids)) as InstanceEnvelope[]
  }

  /** The latest reported value of every metric name this instance has ever sent. */
  getLatestMetricsForInstance (instanceId: string): Map<string, MetricSnapshot> {
    const rows = this.#metricRowsForInstance.all(instanceId) as Array<{ metricJson: string, receivedAt: string }>
    const latest = new Map<string, MetricSnapshot>()

    for (const row of rows) {
      const metric = JSON.parse(row.metricJson) as Metric
      if (!latest.has(metric.name)) {
        latest.set(metric.name, { metric, receivedAt: row.receivedAt })
      }
    }

    return latest
  }

  getMetricKind (instanceId: string, metricName: string): 'daily' | 'cumulative' | null {
    const row = this.#metricKind.get(instanceId, metricName) as { kind: 'daily' | 'cumulative' } | undefined
    return row?.kind ?? null
  }

  getDailyHistory (instanceId: string, metricName: string, options: HistoryOptions): DailyHistoryPoint[] {
    return this.#dailyHistory.all({
      instanceId,
      metricName,
      from: options.from,
      to: options.to,
      limit: options.limit
    }) as DailyHistoryPoint[]
  }

  getCumulativeHistory (instanceId: string, metricName: string, options: HistoryOptions): CumulativeHistoryPoint[] {
    return this.#cumulativeHistory.all({
      instanceId,
      metricName,
      from: options.from,
      to: options.to,
      limit: options.limit
    }) as CumulativeHistoryPoint[]
  }
}
