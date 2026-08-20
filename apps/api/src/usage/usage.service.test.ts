import { test } from 'node:test'
import * as assert from 'node:assert'
import { UsageService, type UsageReport } from './usage.service'
import { type NewUsageEvent, type UsageRepository } from './usage.repository'

const report: UsageReport = {
  instanceId: 'instance-1',
  n8nVersion: '1.99.0',
  dataPoints: [
    { kind: 'cumulative', name: 'activeWorkflows', value: 7 },
    {
      kind: 'daily',
      name: 'prodExecutions',
      value: 42,
      batchId: 'batch-1',
      date: '2026-03-25'
    }
  ]
}

/** Records what the service hands down, so the rules can be asserted directly. */
function fakeRepository () {
  const inserted: NewUsageEvent[] = []

  const repository = {
    insert (event: NewUsageEvent) {
      inserted.push(event)
      return inserted.length
    }
  }

  return { inserted, repository: repository as unknown as UsageRepository }
}

test('stamps the arrival time itself', async () => {
  const { inserted, repository } = fakeRepository()

  new UsageService(repository).recordReport(report)

  assert.equal(inserted.length, 1)
  assert.ok(!Number.isNaN(Date.parse(inserted[0].receivedAt)))
})

test('ignores a received time supplied by the reporting instance', async () => {
  const { inserted, repository } = fakeRepository()
  const spoofed = '1999-01-01T00:00:00.000Z'

  new UsageService(repository).recordReport({ ...report, receivedAt: spoofed } as UsageReport)

  assert.notEqual(inserted[0].receivedAt, spoofed)
})

test('returns the id assigned by the repository', async () => {
  const { repository } = fakeRepository()
  const service = new UsageService(repository)

  assert.deepEqual(service.recordReport(report), { id: 1 })
  assert.deepEqual(service.recordReport(report), { id: 2 })
})
