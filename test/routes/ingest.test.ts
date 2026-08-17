import { test } from 'node:test'
import * as assert from 'node:assert'
import { build } from '../helper'

const URL = '/api/v1/ingest'
const AUTHORIZED = { authorization: 'Bearer test-token' }

const validReport = {
  instanceId: 'instance-1',
  n8nVersion: '1.99.0',
  data: {
    prodExecutions: 15234,
    activeWorkflows: 87,
    successRate: 99.5
  }
}

test('stores an accepted usage report', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    method: 'POST',
    url: URL,
    headers: AUTHORIZED,
    payload: validReport
  })

  assert.equal(res.statusCode, 201)

  const { id } = res.json() as { id: number }
  const row = app.db
    .prepare('SELECT * FROM usage_events WHERE id = ?')
    .get(id) as Record<string, string>

  assert.equal(row.instance_id, 'instance-1')
  assert.equal(row.n8n_version, '1.99.0')
  assert.deepEqual(JSON.parse(row.data), validReport.data)
  assert.ok(!Number.isNaN(Date.parse(row.received_at)))
})

test('appends every report instead of overwriting the instance', async (t) => {
  const app = await build(t)

  for (const prodExecutions of [10, 25]) {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: AUTHORIZED,
      payload: { ...validReport, data: { prodExecutions } }
    })
    assert.equal(res.statusCode, 201)
  }

  const rows = app.db
    .prepare('SELECT data FROM usage_events WHERE instance_id = ? ORDER BY id')
    .all('instance-1') as Array<{ data: string }>

  assert.deepEqual(rows.map((row) => JSON.parse(row.data).prodExecutions), [10, 25])
})

test('rejects a request without a bearer token', async (t) => {
  const app = await build(t)

  const res = await app.inject({ method: 'POST', url: URL, payload: validReport })

  assert.equal(res.statusCode, 401)
})

test('rejects a request with the wrong bearer token', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    method: 'POST',
    url: URL,
    headers: { authorization: 'Bearer not-the-token' },
    payload: validReport
  })

  assert.equal(res.statusCode, 401)
})

test('rejects malformed usage reports', async (t) => {
  const app = await build(t)

  const invalidPayloads: Record<string, unknown> = {
    'missing instanceId': { n8nVersion: '1.99.0', data: { prodExecutions: 1 } },
    'empty instanceId': { ...validReport, instanceId: '' },
    'missing n8nVersion': { instanceId: 'instance-1', data: { prodExecutions: 1 } },
    'missing data': { instanceId: 'instance-1', n8nVersion: '1.99.0' },
    'empty data': { ...validReport, data: {} },
    'string metric value': { ...validReport, data: { prodExecutions: '15234' } },
    'null metric value': { ...validReport, data: { prodExecutions: null } },
    'boolean metric value': { ...validReport, data: { prodExecutions: true } }
  }

  for (const [description, payload] of Object.entries(invalidPayloads)) {
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: AUTHORIZED,
      payload: payload as object
    })

    assert.equal(res.statusCode, 400, `expected 400 for ${description}`)
  }

  const { count } = app.db
    .prepare('SELECT COUNT(*) AS count FROM usage_events')
    .get() as { count: number }

  assert.equal(count, 0)
})

test('ignores unknown top level fields so newer instances stay compatible', async (t) => {
  const app = await build(t)

  const res = await app.inject({
    method: 'POST',
    url: URL,
    headers: AUTHORIZED,
    payload: { ...validReport, someFutureField: 'ignored' }
  })

  assert.equal(res.statusCode, 201)
})
