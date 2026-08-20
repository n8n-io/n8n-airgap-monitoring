import { test } from 'node:test'
import * as assert from 'node:assert'
import { DashboardService } from './dashboard.service'
import type {
  DashboardRepository,
  InstanceEnvelope,
  InstancePageRow,
  MetricSnapshot
} from './dashboard.repository'

interface FakeRepositoryOptions {
  instancePage?: InstancePageRow[]
  envelopes?: InstanceEnvelope[]
  metricsByInstance?: Record<string, Map<string, MetricSnapshot>>
  metricKind?: 'daily' | 'cumulative' | null
}

/** Records what the service calls, so its business rules can be asserted directly. */
function fakeRepository (options: FakeRepositoryOptions = {}) {
  const calls: Record<string, unknown[][]> = {}
  const record = (name: string, args: unknown[]): void => {
    calls[name] = calls[name] ?? []
    calls[name].push(args)
  }

  const repository = {
    listInstancePage (cursor: number | null, fetchCount: number) {
      record('listInstancePage', [cursor, fetchCount])
      return options.instancePage ?? []
    },
    getEnvelopes (ids: number[]) {
      record('getEnvelopes', [ids])
      return options.envelopes ?? []
    },
    getLatestMetricsForInstance (instanceId: string) {
      record('getLatestMetricsForInstance', [instanceId])
      return options.metricsByInstance?.[instanceId] ?? new Map()
    },
    getMetricKind (instanceId: string, metricName: string) {
      record('getMetricKind', [instanceId, metricName])
      return options.metricKind ?? null
    },
    getDailyHistory (...args: unknown[]) {
      record('getDailyHistory', args)
      return []
    },
    getCumulativeHistory (...args: unknown[]) {
      record('getCumulativeHistory', args)
      return []
    }
  }

  return { calls, repository: repository as unknown as DashboardRepository }
}

test('builds a page-scoped metric-name union with a sparse per-instance metrics map', async () => {
  const { repository } = fakeRepository({
    instancePage: [{ instanceId: 'a', latestId: 2 }, { instanceId: 'b', latestId: 1 }],
    envelopes: [
      { id: 2, instanceId: 'a', label: null, n8nVersion: '1.0.0', receivedAt: 't2' },
      { id: 1, instanceId: 'b', label: null, n8nVersion: '1.0.0', receivedAt: 't1' }
    ],
    metricsByInstance: {
      a: new Map([['x', { metric: { kind: 'cumulative', name: 'x', value: 1 }, receivedAt: 't2' }]]),
      b: new Map([['y', { metric: { kind: 'cumulative', name: 'y', value: 2 }, receivedAt: 't1' }]])
    }
  })

  const page = new DashboardService(repository).listInstances(null, 2)

  assert.deepEqual(page.metricNames, ['x', 'y'])
  assert.deepEqual(Object.keys(page.instances[0].metrics), ['x'])
  assert.deepEqual(Object.keys(page.instances[1].metrics), ['y'])
})

test('a daily metric snapshot carries its date, a cumulative one does not', async () => {
  const { repository } = fakeRepository({
    instancePage: [{ instanceId: 'a', latestId: 1 }],
    envelopes: [{ id: 1, instanceId: 'a', label: null, n8nVersion: '1.0.0', receivedAt: 't1' }],
    metricsByInstance: {
      a: new Map([
        ['prodExecutions', {
          metric: { kind: 'daily', name: 'prodExecutions', value: 10, batchId: 'b1', date: '2026-03-25' },
          receivedAt: 't1'
        }],
        ['activeWorkflows', {
          metric: { kind: 'cumulative', name: 'activeWorkflows', value: 7 },
          receivedAt: 't1'
        }]
      ])
    }
  })

  const page = new DashboardService(repository).listInstances(null, 5)
  const metrics = page.instances[0].metrics

  assert.equal(metrics.prodExecutions.kind, 'daily')
  assert.equal(metrics.prodExecutions.kind === 'daily' ? metrics.prodExecutions.date : undefined, '2026-03-25')
  assert.ok(!('date' in metrics.activeWorkflows))
})

test('nextCursor is null exactly when fewer than limit+1 rows come back', async () => {
  const { repository } = fakeRepository({
    instancePage: [{ instanceId: 'a', latestId: 1 }],
    envelopes: [{ id: 1, instanceId: 'a', label: null, n8nVersion: '1.0.0', receivedAt: 't1' }]
  })

  const page = new DashboardService(repository).listInstances(null, 5)

  assert.equal(page.nextCursor, null)
  assert.equal(page.instances.length, 1)
})

test('nextCursor is set to the last kept row when the page is full', async () => {
  const { repository } = fakeRepository({
    instancePage: [
      { instanceId: 'a', latestId: 3 },
      { instanceId: 'b', latestId: 2 },
      { instanceId: 'c', latestId: 1 }
    ],
    envelopes: [
      { id: 3, instanceId: 'a', label: null, n8nVersion: '1.0.0', receivedAt: 't3' },
      { id: 2, instanceId: 'b', label: null, n8nVersion: '1.0.0', receivedAt: 't2' },
      { id: 1, instanceId: 'c', label: null, n8nVersion: '1.0.0', receivedAt: 't1' }
    ]
  })

  const page = new DashboardService(repository).listInstances(null, 2)

  assert.equal(page.instances.length, 2)
  assert.equal(page.nextCursor, 2)
})

test('getMetricHistory returns null without querying history when the metric kind is unknown', async () => {
  const { calls, repository } = fakeRepository({ metricKind: null })

  const result = new DashboardService(repository).getMetricHistory('a', 'unknown', { from: null, to: null, limit: 10 })

  assert.equal(result, null)
  assert.equal(calls.getDailyHistory, undefined)
  assert.equal(calls.getCumulativeHistory, undefined)
})

test('getMetricHistory delegates to the repository method matching the metric kind', async () => {
  const { calls, repository } = fakeRepository({ metricKind: 'daily' })

  new DashboardService(repository).getMetricHistory('a', 'prodExecutions', { from: null, to: null, limit: 10 })

  assert.equal(calls.getDailyHistory?.length, 1)
  assert.equal(calls.getCumulativeHistory, undefined)
})
