import { describe, expect, it } from 'vitest'
import type { DailyPoint } from './report'
import { summarize } from './summary'

const daily = (date: string, batchId: string): DailyPoint => ({
  kind: 'daily',
  date,
  value: 1,
  batchId,
  receivedAt: `${date}T23:00:00.000Z`,
})

describe('summarize', () => {
  it('keeps every anomaly, but only those of the last 60 days as recent', () => {
    const [summary] = summarize(
      [
        {
          instanceId: 'instance-1',
          label: null,
          firstSeen: '2026-08-01T00:00:00.000Z',
          lastReportAt: '2026-10-01T00:00:00.000Z',
          dataPoints: {
            // The same day twice, once long ago and once a week ago.
            execs: [
              daily('2026-08-01', 'a'),
              daily('2026-08-01', 'b'),
              daily('2026-10-01', 'c'),
              daily('2026-10-01', 'd'),
            ],
          },
        },
      ],
      '2026-10-08T08:00:00.000Z',
    )

    expect(
      summary?.anomalies.map((anomaly) => anomaly.type === 'duplicate-day' && anomaly.date),
    ).toEqual(['2026-08-01', '2026-10-01'])
    expect(
      summary?.recentAnomalies.map((anomaly) => anomaly.type === 'duplicate-day' && anomaly.date),
    ).toEqual(['2026-10-01'])
  })
})
