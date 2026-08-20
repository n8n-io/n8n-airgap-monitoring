import { test } from 'node:test'
import * as assert from 'node:assert'
import { build } from '../../../../testing/build-app'
import type { TestContext } from '../../../../testing/build-app'

const INGEST_URL = '/api/v1/ingest'
const AUTHORIZED = { authorization: 'Bearer test-token' }

async function ingest (app: Awaited<ReturnType<typeof build>>, payload: object) {
  return app.inject({ method: 'POST', url: INGEST_URL, headers: AUTHORIZED, payload })
}

test('lists instances without requiring auth', async (t: TestContext) => {
  const app = await build(t)
  await ingest(app, {
    instanceId: 'a',
    n8nVersion: '1.0.0',
    dataPoints: [{ kind: 'cumulative', name: 'activeWorkflows', value: 5 }]
  })

  const res = await app.inject({ method: 'GET', url: '/api/v1/instances' })

  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.instances.length, 1)
  assert.equal(body.instances[0].instanceId, 'a')
  assert.deepEqual(body.metricNames, ['activeWorkflows'])
  assert.equal(body.nextCursor, null)
})

test('paginates over distinct instances using a cursor', async (t: TestContext) => {
  const app = await build(t)
  for (const instanceId of ['a', 'b', 'c']) {
    await ingest(app, {
      instanceId,
      n8nVersion: '1.0.0',
      dataPoints: [{ kind: 'cumulative', name: 'x', value: 1 }]
    })
  }

  const firstPage = await app.inject({ method: 'GET', url: '/api/v1/instances?limit=2' })
  const firstBody = firstPage.json()

  assert.deepEqual(firstBody.instances.map((i: { instanceId: string }) => i.instanceId), ['c', 'b'])
  assert.notEqual(firstBody.nextCursor, null)

  const secondPage = await app.inject({
    method: 'GET',
    url: `/api/v1/instances?limit=2&cursor=${firstBody.nextCursor}`
  })
  const secondBody = secondPage.json()

  assert.deepEqual(secondBody.instances.map((i: { instanceId: string }) => i.instanceId), ['a'])
  assert.equal(secondBody.nextCursor, null)
})

test('exposes the union of metric names across the page, sparse per instance', async (t: TestContext) => {
  const app = await build(t)
  await ingest(app, { instanceId: 'a', n8nVersion: '1.0.0', dataPoints: [{ kind: 'cumulative', name: 'onlyA', value: 1 }] })
  await ingest(app, { instanceId: 'b', n8nVersion: '1.0.0', dataPoints: [{ kind: 'cumulative', name: 'onlyB', value: 2 }] })

  const res = await app.inject({ method: 'GET', url: '/api/v1/instances' })
  const body = res.json()

  assert.deepEqual(body.metricNames, ['onlyA', 'onlyB'])

  const byId = Object.fromEntries(body.instances.map((i: { instanceId: string }) => [i.instanceId, i]))
  assert.ok('onlyA' in byId.a.metrics)
  assert.ok(!('onlyB' in byId.a.metrics))
  assert.ok('onlyB' in byId.b.metrics)
  assert.ok(!('onlyA' in byId.b.metrics))
})

test('history endpoint 404s for an unknown instance/metric pair', async (t: TestContext) => {
  const app = await build(t)

  const res = await app.inject({ method: 'GET', url: '/api/v1/instances/unknown/metrics/whatever/history' })

  assert.equal(res.statusCode, 404)
})

test('history endpoint does not require auth and shapes daily vs cumulative points differently', async (t: TestContext) => {
  const app = await build(t)
  await ingest(app, {
    instanceId: 'a',
    n8nVersion: '1.0.0',
    dataPoints: [
      { kind: 'daily', name: 'prodExecutions', value: 10, batchId: 'batch-1', date: '2026-03-25' },
      { kind: 'cumulative', name: 'activeWorkflows', value: 7 }
    ]
  })

  const dailyRes = await app.inject({ method: 'GET', url: '/api/v1/instances/a/metrics/prodExecutions/history' })
  const dailyBody = dailyRes.json()
  assert.equal(dailyRes.statusCode, 200)
  assert.equal(dailyBody.kind, 'daily')
  assert.deepEqual(dailyBody.points, [
    { date: '2026-03-25', value: 10, batchId: 'batch-1', receivedAt: dailyBody.points[0].receivedAt }
  ])

  const cumulativeRes = await app.inject({ method: 'GET', url: '/api/v1/instances/a/metrics/activeWorkflows/history' })
  const cumulativeBody = cumulativeRes.json()
  assert.equal(cumulativeBody.kind, 'cumulative')
  assert.equal(cumulativeBody.points.length, 1)
  assert.ok(!('date' in cumulativeBody.points[0]))
})

test('history endpoint filters by from/to date range', async (t: TestContext) => {
  const app = await build(t)
  await ingest(app, {
    instanceId: 'a',
    n8nVersion: '1.0.0',
    dataPoints: [{ kind: 'daily', name: 'prodExecutions', value: 1, batchId: 'batch-1', date: '2026-03-01' }]
  })
  await ingest(app, {
    instanceId: 'a',
    n8nVersion: '1.0.0',
    dataPoints: [{ kind: 'daily', name: 'prodExecutions', value: 2, batchId: 'batch-2', date: '2026-03-25' }]
  })

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/instances/a/metrics/prodExecutions/history?from=2026-03-10'
  })
  const body = res.json()

  assert.deepEqual(body.points.map((p: { date: string }) => p.date), ['2026-03-25'])
})
