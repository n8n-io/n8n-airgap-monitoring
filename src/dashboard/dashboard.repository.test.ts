import { test } from 'node:test'
import * as assert from 'node:assert'
import type Database from 'better-sqlite3'
import { build } from '../testing/build-app'
import { DashboardRepository } from './dashboard.repository'

interface SeedRow {
  instanceId: string
  label?: string | null
  n8nVersion?: string
  dataPoints: unknown[]
  receivedAt: string
}

/** Inserts a raw event the same way UsageRepository.insert does, bypassing the service. */
function seed (db: Database.Database, row: SeedRow): number {
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO usage_events (instance_id, label, n8n_version, data, received_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    row.instanceId,
    row.label ?? null,
    row.n8nVersion ?? '1.99.0',
    JSON.stringify(row.dataPoints),
    row.receivedAt
  )

  return Number(lastInsertRowid)
}

test('listInstancePage orders by most recent event and excludes rows at/after the cursor', async (t) => {
  const app = await build(t)
  const repository = new DashboardRepository(app.db)

  const idA = seed(app.db, { instanceId: 'a', dataPoints: [], receivedAt: '2026-01-01T00:00:00.000Z' })
  const idB = seed(app.db, { instanceId: 'b', dataPoints: [], receivedAt: '2026-01-02T00:00:00.000Z' })
  const idC = seed(app.db, { instanceId: 'c', dataPoints: [], receivedAt: '2026-01-03T00:00:00.000Z' })

  assert.deepEqual(repository.listInstancePage(null, 2), [
    { instanceId: 'c', latestId: idC },
    { instanceId: 'b', latestId: idB }
  ])

  assert.deepEqual(repository.listInstancePage(idB, 2), [
    { instanceId: 'a', latestId: idA }
  ])
})

test('listInstancePage groups by instance, keyed off its most recent event', async (t) => {
  const app = await build(t)
  const repository = new DashboardRepository(app.db)

  seed(app.db, { instanceId: 'a', dataPoints: [], receivedAt: '2026-01-01T00:00:00.000Z' })
  const secondEventForA = seed(app.db, { instanceId: 'a', dataPoints: [], receivedAt: '2026-01-05T00:00:00.000Z' })

  assert.deepEqual(repository.listInstancePage(null, 10), [
    { instanceId: 'a', latestId: secondEventForA }
  ])
})

test('getEnvelopes returns only the requested rows', async (t) => {
  const app = await build(t)
  const repository = new DashboardRepository(app.db)

  const idA = seed(app.db, { instanceId: 'a', label: 'Label A', dataPoints: [], receivedAt: '2026-01-01T00:00:00.000Z' })
  seed(app.db, { instanceId: 'b', dataPoints: [], receivedAt: '2026-01-02T00:00:00.000Z' })

  const envelopes = repository.getEnvelopes([idA])

  assert.equal(envelopes.length, 1)
  assert.equal(envelopes[0].instanceId, 'a')
  assert.equal(envelopes[0].label, 'Label A')
})

test('getLatestMetricsForInstance keeps the newest value per metric name across separate reports', async (t) => {
  const app = await build(t)
  const repository = new DashboardRepository(app.db)

  seed(app.db, {
    instanceId: 'a',
    receivedAt: '2026-01-01T00:00:00.000Z',
    dataPoints: [
      { kind: 'cumulative', name: 'activeWorkflows', value: 1 },
      { kind: 'cumulative', name: 'successRate', value: 99 }
    ]
  })
  seed(app.db, {
    instanceId: 'a',
    receivedAt: '2026-01-02T00:00:00.000Z',
    // Only reports one of the two metrics this time.
    dataPoints: [{ kind: 'cumulative', name: 'activeWorkflows', value: 5 }]
  })

  const latest = repository.getLatestMetricsForInstance('a')

  assert.equal(latest.get('activeWorkflows')?.metric.value, 5)
  assert.equal(latest.get('activeWorkflows')?.receivedAt, '2026-01-02T00:00:00.000Z')
  assert.equal(latest.get('successRate')?.metric.value, 99)
  assert.equal(latest.get('successRate')?.receivedAt, '2026-01-01T00:00:00.000Z')
})

test('getMetricKind returns null for a metric that was never reported', async (t) => {
  const app = await build(t)
  const repository = new DashboardRepository(app.db)

  assert.equal(repository.getMetricKind('unknown-instance', 'unknown-metric'), null)
})

test('getDailyHistory returns every row without deduping retries or collisions, filtered by date range', async (t) => {
  const app = await build(t)
  const repository = new DashboardRepository(app.db)

  seed(app.db, {
    instanceId: 'a',
    receivedAt: '2026-03-01T00:00:00.000Z',
    dataPoints: [{ kind: 'daily', name: 'prodExecutions', value: 10, batchId: 'batch-1', date: '2026-03-01' }]
  })
  // Two instances sharing an instanceId (different batchId) both surface, unmerged.
  seed(app.db, {
    instanceId: 'a',
    receivedAt: '2026-03-25T00:00:00.000Z',
    dataPoints: [{ kind: 'daily', name: 'prodExecutions', value: 20, batchId: 'batch-2', date: '2026-03-25' }]
  })
  seed(app.db, {
    instanceId: 'a',
    receivedAt: '2026-03-26T00:00:00.000Z',
    dataPoints: [{ kind: 'daily', name: 'prodExecutions', value: 21, batchId: 'batch-3', date: '2026-03-25' }]
  })

  const all = repository.getDailyHistory('a', 'prodExecutions', { from: null, to: null, limit: 100 })
  assert.equal(all.length, 3)
  assert.deepEqual(all.map((point) => point.batchId), ['batch-1', 'batch-2', 'batch-3'])

  const filtered = repository.getDailyHistory('a', 'prodExecutions', { from: '2026-03-10', to: null, limit: 100 })
  assert.deepEqual(filtered.map((point) => point.batchId), ['batch-2', 'batch-3'])
})

test('getCumulativeHistory orders by arrival time and honors from/to', async (t) => {
  const app = await build(t)
  const repository = new DashboardRepository(app.db)

  seed(app.db, {
    instanceId: 'a',
    receivedAt: '2026-01-01T00:00:00.000Z',
    dataPoints: [{ kind: 'cumulative', name: 'activeWorkflows', value: 1 }]
  })
  seed(app.db, {
    instanceId: 'a',
    receivedAt: '2026-01-03T00:00:00.000Z',
    dataPoints: [{ kind: 'cumulative', name: 'activeWorkflows', value: 3 }]
  })

  const all = repository.getCumulativeHistory('a', 'activeWorkflows', { from: null, to: null, limit: 100 })
  assert.deepEqual(all.map((point) => point.value), [1, 3])

  const filtered = repository.getCumulativeHistory('a', 'activeWorkflows', {
    from: '2026-01-02T00:00:00.000Z',
    to: null,
    limit: 100
  })
  assert.deepEqual(filtered.map((point) => point.value), [3])
})
