import { test } from 'node:test'
import * as assert from 'node:assert'
import { build } from '../../testing/build-app'
import type { TestContext } from '../../testing/build-app'

const AUTHORIZED = { authorization: 'Bearer test-token' }

async function ingest (app: Awaited<ReturnType<typeof build>>, payload: object) {
  return app.inject({ method: 'POST', url: '/api/v1/ingest', headers: AUTHORIZED, payload })
}

test('serves the dashboard as an unauthenticated HTML page', async (t: TestContext) => {
  const app = await build(t)

  const res = await app.inject({ method: 'GET', url: '/dashboard' })

  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'] as string, /text\/html/)
  assert.match(res.body, /id="instances-table"/)
  assert.match(res.body, /<script type="module" src="\/dashboard\/dashboard.client.js"><\/script>/)
})

test('serves the compiled client bundle alongside the page', async (t: TestContext) => {
  const app = await build(t)

  const res = await app.inject({ method: 'GET', url: '/dashboard/dashboard.client.js' })

  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'] as string, /text\/javascript/)
  // Compiled from dashboard.client.ts, so the TypeScript must be gone but its
  // behaviour present.
  assert.ok(!res.body.includes(': HTMLButtonElement'))
  assert.match(res.body, /\/dashboard\/rows\?/)
})

test('renders instances and their latest metric values server-side', async (t: TestContext) => {
  const app = await build(t)
  await ingest(app, {
    instanceId: 'instance-a',
    label: 'Acme Prod',
    n8nVersion: '1.2.3',
    dataPoints: [
      { kind: 'cumulative', name: 'activeWorkflows', value: 5 },
      { kind: 'daily', name: 'prodExecutions', value: 10, batchId: 'batch-1', date: '2026-03-25' }
    ]
  })

  await ingest(app, {
    instanceId: 'instance-b',
    n8nVersion: '1.2.3',
    dataPoints: [{ kind: 'cumulative', name: 'activeWorkflows', value: 2 }]
  })

  const res = await app.inject({ method: 'GET', url: '/dashboard' })

  // No fetch needed for the table itself: the first response already has it.
  assert.match(res.body, /<th data-metric="activeWorkflows">activeWorkflows<\/th>/)
  // instance-b never reported prodExecutions, so its cell stays blank.
  assert.match(res.body, /<td class="empty-cell">—<\/td>/)
  // A missing label renders as the same placeholder.
  assert.match(res.body, /<td>—<\/td>/)
  assert.match(res.body, /<td>instance-a<\/td>/)
  assert.match(res.body, /<td>Acme Prod<\/td>/)
  assert.match(res.body, /data-instance-id="instance-a" data-metric="activeWorkflows">5</)
  assert.match(res.body, /data-metric="prodExecutions">10 \(2026-03-25\)</)
})

test('shows an empty state when nothing has reported yet', async (t: TestContext) => {
  const app = await build(t)

  const res = await app.inject({ method: 'GET', url: '/dashboard' })

  assert.match(res.body, /No instances have reported usage yet/)
})

test('escapes instance-supplied values instead of injecting them as markup', async (t: TestContext) => {
  const app = await build(t)
  await ingest(app, {
    instanceId: '<script>alert(1)</script>',
    label: '" onmouseover="alert(2)',
    n8nVersion: '1.0.0',
    dataPoints: [{ kind: 'cumulative', name: '<img src=x onerror=alert(3)>', value: 1 }]
  })

  const res = await app.inject({ method: 'GET', url: '/dashboard' })

  assert.ok(!res.body.includes('<script>alert(1)</script>'))
  assert.ok(!res.body.includes('" onmouseover="'), 'a quote must not escape its attribute')
  assert.ok(!res.body.includes('<img src=x'))
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(res.body, /&quot; onmouseover=&quot;alert\(2\)/)
})

test('offers a load-more button only while further pages exist', async (t: TestContext) => {
  const app = await build(t)
  // One more than the page size, so a second page exists.
  for (let index = 0; index < 26; index++) {
    await ingest(app, {
      instanceId: `instance-${index}`,
      n8nVersion: '1.0.0',
      dataPoints: [{ kind: 'cumulative', name: 'x', value: index }]
    })
  }

  const firstPage = await app.inject({ method: 'GET', url: '/dashboard' })
  const cursorMatch = /<button id="load-more" type="button" data-cursor="(\d+)">/.exec(firstPage.body)

  assert.ok(cursorMatch !== null, 'first page should offer more')
  assert.ok(!firstPage.body.includes('<td>instance-0</td>'), 'oldest instance is on page two')

  const rows = await app.inject({ method: 'GET', url: `/dashboard/rows?cursor=${cursorMatch[1]}&columns=x` })
  const body = rows.json()

  assert.equal(rows.statusCode, 200)
  assert.match(body.rowsHtml, /<td>instance-0<\/td>/)
  assert.deepEqual(body.newColumns, [])
  assert.equal(body.nextCursor, null, 'nothing left after the second page')
})

test('appends columns a later page introduces, after the ones already shown', async (t: TestContext) => {
  const app = await build(t)
  await ingest(app, { instanceId: 'older', n8nVersion: '1.0.0', dataPoints: [{ kind: 'cumulative', name: 'onlyOnPageTwo', value: 1 }] })
  await ingest(app, { instanceId: 'newer', n8nVersion: '1.0.0', dataPoints: [{ kind: 'cumulative', name: 'shown', value: 2 }] })

  // Metric headers are tagged so the script can report the columns it shows.
  const firstPage = await app.inject({ method: 'GET', url: '/dashboard' })
  assert.match(firstPage.body, /<th data-metric="shown">shown<\/th>/)

  // Stands in for a client whose visible page only ever contained `shown`.
  const rows = await app.inject({ method: 'GET', url: '/dashboard/rows?cursor=2&columns=shown' })
  const body = rows.json()

  assert.deepEqual(body.newColumns, ['onlyOnPageTwo'])
  // Known column first (empty for this instance), then the newly discovered one.
  assert.match(body.rowsHtml, /<td class="empty-cell">—<\/td><td class="metric-cell"[^>]*data-metric="onlyOnPageTwo">1</)
})

test('escapes rendered values in appended rows too', async (t: TestContext) => {
  const app = await build(t)
  await ingest(app, { instanceId: '"><b>x</b>', n8nVersion: '1.0.0', dataPoints: [{ kind: 'cumulative', name: 'x', value: 1 }] })
  await ingest(app, { instanceId: 'newer', n8nVersion: '1.0.0', dataPoints: [{ kind: 'cumulative', name: 'x', value: 1 }] })

  const rows = await app.inject({ method: 'GET', url: '/dashboard/rows?cursor=2&columns=x' })

  assert.ok(!rows.json().rowsHtml.includes('<b>x</b>'))
})

test('rejects a malformed cursor rather than rendering rows', async (t: TestContext) => {
  const app = await build(t)

  const res = await app.inject({ method: 'GET', url: '/dashboard/rows?cursor=not-a-number' })

  assert.equal(res.statusCode, 400)
})
