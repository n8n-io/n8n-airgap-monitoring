import { describe, expect, it } from 'vitest'
import { addDays, anomalyDay, type InstanceReportEntry } from './report'
import { summarize } from './summary'

const generatedAt = '2026-10-08T08:00:00.000Z'
const daysOld = (days: number) => addDays('2026-10-08', -days)

function instanceWithAnomaliesOn(dates: string[]): InstanceReportEntry {
  return {
    instanceId: 'instance-1',
    label: null,
    firstSeen: '2026-07-01T00:00:00.000Z',
    lastReportAt: '2026-10-07T23:00:00.000Z',
    dataPoints: {
      execs: dates.flatMap((date) =>
        ['a', 'b'].map((batchId) => ({
          kind: 'daily' as const,
          date,
          value: 1,
          batchId,
          receivedAt: `${date}T23:00:00.000Z`,
        })),
      ),
    },
  }
}

const instance = instanceWithAnomaliesOn([
  daysOld(1),
  daysOld(30),
  daysOld(60),
  daysOld(61),
  daysOld(90),
])

describe('summarize', () => {
  it('when anomalies are up to 60 days old, then they are in all anomalies and in recent', () => {
    const [summary] = summarize([instance], generatedAt)

    expect(summary?.anomalies.map(anomalyDay)).toEqual(
      expect.arrayContaining([daysOld(1), daysOld(30), daysOld(60)]),
    )
    expect(summary?.recentAnomalies.map(anomalyDay)).toEqual([daysOld(1), daysOld(30), daysOld(60)])
  })

  it('when anomalies are more than 60 days old, then they are in all anomalies, but not in recent', () => {
    const [summary] = summarize([instance], generatedAt)

    expect(summary?.anomalies.map(anomalyDay)).toEqual(
      expect.arrayContaining([daysOld(61), daysOld(90)]),
    )
    expect(summary?.recentAnomalies.map(anomalyDay)).not.toContain(daysOld(61))
    expect(summary?.recentAnomalies.map(anomalyDay)).not.toContain(daysOld(90))
  })
})
