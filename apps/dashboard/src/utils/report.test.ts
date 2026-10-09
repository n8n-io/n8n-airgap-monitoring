import { describe, expect, it } from 'vitest'
import {
  type CumulativePoint,
  type DailyPoint,
  daysFrom,
  findAnomalies,
  growthPerBatch,
  type InstanceReportEntry,
  latestPoint,
  metricColumns,
  type ReportedMetric,
  rawRows,
  anomaliesByCell,
  statusOf,
  sumDaily,
} from './report'

function daily(
  date: string,
  value: number,
  batchId = `batch-${date}`,
  receivedAt = `${date}T23:00:00.000Z`,
): DailyPoint {
  return { kind: 'daily', date, value, batchId, receivedAt }
}

function cumulative(
  receivedAt: string,
  value: number,
  batchId = `batch-${receivedAt}`,
): CumulativePoint {
  return { kind: 'cumulative', value, batchId, receivedAt }
}

/** One batch: when it arrived, the dailies it carries, and its total. */
type Batch = [receivedAt: string, dailies: Record<string, number>, total: number]

function batches(...rows: Batch[]): ReportedMetric[] {
  return rows.flatMap(([receivedAt, dailies, total], i) => [
    ...Object.entries(dailies).map(([date, value]) =>
      daily(date, value, `batch-${i + 1}`, receivedAt),
    ),
    cumulative(receivedAt, total, `batch-${i + 1}`),
  ])
}

function mismatch(expected: {
  cumulativeDelta: number
  dailySum: number
  days: string[]
  at: string
}) {
  return {
    type: 'cumulative-daily-mismatch',
    name: 'execs',
    cumulativeDelta: expected.cumulativeDelta,
    dailySum: expected.dailySum,
    fromDate: expected.days[0],
    toDate: expected.days[expected.days.length - 1],
    receivedAt: expected.at,
  }
}

function instance(dataPoints: Record<string, ReportedMetric[]>): InstanceReportEntry {
  return {
    instanceId: 'instance-1',
    label: null,
    firstSeen: '2026-08-01T00:00:00.000Z',
    lastReportAt: '2026-08-10T00:00:00.000Z',
    dataPoints,
  }
}

describe('statusOf', () => {
  const generatedAt = '2026-08-20T08:00:00.000Z'

  it.each([
    ['2026-08-20T07:00:00.000Z', 'active'],
    ['2026-08-06T00:00:00.000Z', 'active'],
    ['2026-08-05T23:59:59.000Z', 'stale'],
    ['2026-07-21T00:00:00.000Z', 'stale'],
    ['2026-07-20T23:59:59.000Z', 'offline'],
  ])('is %s → %s', (lastReportAt, status) => {
    expect(statusOf(lastReportAt, generatedAt)).toBe(status)
  })
})

describe('metricColumns', () => {
  it('gives each kind of a name its own column, sorted', () => {
    const columns = metricColumns([
      instance({ b: [cumulative('2026-08-01T00:00:00.000Z', 1)] }),
      instance({ a: [daily('2026-08-01', 1), cumulative('2026-08-01T00:00:00.000Z', 1)] }),
    ])

    expect(columns).toEqual([
      { name: 'a', kind: 'daily' },
      { name: 'a', kind: 'cumulative' },
      { name: 'b', kind: 'cumulative' },
    ])
  })
})

describe('latestPoint', () => {
  it('takes the last received cumulative, whatever the order of the list', () => {
    const points = [
      cumulative('2026-08-01T00:00:00Z', 5),
      cumulative('2026-08-02T00:00:00Z', 3),
      cumulative('2026-07-30T00:00:00Z', 2),
    ]

    expect(latestPoint(points)?.value).toBe(3)
  })

  it('takes the newest date of a daily, not the last received', () => {
    const points = [daily('2026-08-01', 7), daily('2026-08-03', 9), daily('2026-08-02', 8)]

    expect(latestPoint(points)).toMatchObject({
      date: '2026-08-03',
      value: 9,
    })
  })

  it('takes the last received of several values for the newest date', () => {
    expect(latestPoint([daily('2026-08-03', 9, 'a'), daily('2026-08-03', 4, 'b')])?.batchId).toBe(
      'b',
    )
  })

  it('is undefined without points', () => {
    expect(latestPoint([])).toBeUndefined()
  })
})

describe('findAnomalies', () => {
  it('flags a day reported in two different batches', () => {
    const anomalies = findAnomalies(
      instance({
        execs: [
          daily('2026-08-20', 0, 'a'),
          daily('2026-08-20', 0, 'b'),
          daily('2026-08-21', 1, 'c'),
        ],
      }),
    )

    expect(anomalies).toEqual([
      {
        type: 'duplicate-day',
        name: 'execs',
        date: '2026-08-20',
        count: 2,
        batchIds: ['a', 'b'],
      },
    ])
  })

  it('flags a day repeated in the same batch', () => {
    expect(
      findAnomalies(
        instance({ execs: [daily('2026-08-20', 1, 'a'), daily('2026-08-20', 1, 'a')] }),
      ),
    ).toEqual([
      { type: 'duplicate-day', name: 'execs', date: '2026-08-20', count: 2, batchIds: ['a'] },
    ])
  })

  it('flags a cumulative that went down', () => {
    const anomalies = findAnomalies(
      instance({
        execs: [cumulative('2026-08-01T00:00:00Z', 100), cumulative('2026-08-02T00:00:00Z', 40)],
      }),
    )

    expect(anomalies).toEqual([
      {
        type: 'cumulative-regression',
        name: 'execs',
        from: 100,
        to: 40,
        receivedAt: '2026-08-02T00:00:00Z',
      },
    ])
  })

  describe('cumulative against daily', () => {
    it('accepts totals that grow by the dailies of their batch, give or take part of a day', () => {
      const execs = batches(
        // arrived            dailies in the batch      total
        ['2026-03-01T19:00Z', { '2026-02-28': 1000 }, 10_000],
        // +1,100: the total already counts 2 March until 19:00
        ['2026-03-02T19:00Z', { '2026-03-01': 1000 }, 11_100],
        ['2026-03-03T19:00Z', { '2026-03-02': 900 }, 11_900],
      )

      expect(findAnomalies(instance({ execs }))).toEqual([])
    })

    it('accepts a weekly batch: seven dailies and one total', () => {
      const week = {
        '2026-03-01': 100,
        '2026-03-02': 100,
        '2026-03-03': 100,
        '2026-03-04': 100,
        '2026-03-05': 100,
        '2026-03-06': 100,
        '2026-03-07': 100,
      }
      const execs = batches(
        ['2026-03-01T06:00Z', { '2026-02-28': 100 }, 5000],
        ['2026-03-08T06:00Z', week, 5700],
      )

      expect(findAnomalies(instance({ execs }))).toEqual([])
    })

    it('flags each batch whose total grew by more than a day beyond its dailies', () => {
      const execs = batches(
        ['2026-03-01T06:00Z', { '2026-02-28': 100 }, 1000],
        ['2026-03-02T06:00Z', { '2026-03-01': 100 }, 1100],
        ['2026-03-03T06:00Z', { '2026-03-02': 100 }, 5000], // +3,900 against 100
        ['2026-03-04T06:00Z', { '2026-03-03': 100 }, 5100],
        ['2026-03-05T06:00Z', { '2026-03-04': 100 }, 6000], // +900 against 100
        ['2026-03-06T06:00Z', { '2026-03-05': 100 }, 6100],
      )

      expect(findAnomalies(instance({ execs }))).toEqual([
        mismatch({
          cumulativeDelta: 3900,
          dailySum: 100,
          days: ['2026-03-02'],
          at: '2026-03-03T06:00Z',
        }),
        mismatch({
          cumulativeDelta: 900,
          dailySum: 100,
          days: ['2026-03-04'],
          at: '2026-03-05T06:00Z',
        }),
      ])
    })

    it('does not check the latest batch: the day it was made has no daily yet', () => {
      const execs = batches(
        ['2026-03-01T19:00Z', { '2026-02-28': 100 }, 1000],
        // +900: 2 March was busy until 19:00, but its daily only comes with the next batch
        ['2026-03-02T19:00Z', { '2026-03-01': 100 }, 1900],
      )

      expect(findAnomalies(instance({ execs }))).toEqual([])
    })

    it("measures the slack by the batch's own days, not the busiest day ever", () => {
      const execs = batches(
        ['2026-03-01T06:00Z', { '2026-02-28': 5000 }, 10_000], // a busy day long ago
        ['2026-03-02T06:00Z', { '2026-03-01': 100 }, 10_100],
        ['2026-03-03T06:00Z', { '2026-03-02': 100 }, 10_800], // +700 against 100 on quiet days
        ['2026-03-04T06:00Z', { '2026-03-03': 100 }, 10_900],
      )

      expect(findAnomalies(instance({ execs }))).toEqual([
        mismatch({
          cumulativeDelta: 700,
          dailySum: 100,
          days: ['2026-03-02'],
          at: '2026-03-03T06:00Z',
        }),
      ])
    })
  })
})

describe('daysFrom', () => {
  it('lists every day, both ends included, across a month end', () => {
    expect(daysFrom('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ])
  })

  it('is empty when the range ends before it starts', () => {
    expect(daysFrom('2026-08-02', '2026-08-01')).toEqual([])
  })
})

describe('sumDaily', () => {
  it('sums instances per date, counting one value per instance and date', () => {
    const sums = sumDaily(
      [
        instance({ execs: [daily('2026-08-01', 5, 'a'), daily('2026-08-01', 7, 'b')] }),
        instance({
          execs: [
            daily('2026-08-01', 10),
            daily('2026-08-02', 1),
            cumulative('2026-08-02T00:00:00Z', 99),
          ],
        }),
      ],
      'execs',
    )

    expect(sums).toEqual(
      new Map([
        ['2026-08-01', 17],
        ['2026-08-02', 1],
      ]),
    )
  })
})

describe('growthPerBatch', () => {
  it("covers the days of the batch's own dailies, however late it arrived", () => {
    const execs = batches(
      ['2026-03-01T06:00Z', { '2026-02-28': 100 }, 1000],
      ['2026-03-03T23:00Z', { '2026-03-01': 100 }, 1100], // made on 2 March, delivered a day late
      ['2026-03-04T06:00Z', { '2026-03-02': 100, '2026-03-03': 100 }, 1300],
    )

    expect(
      growthPerBatch(execs).map(({ days, growth, dailySum }) => ({ days, growth, dailySum })),
    ).toEqual([
      { days: ['2026-03-01'], growth: 100, dailySum: 100 },
      { days: ['2026-03-02', '2026-03-03'], growth: 200, dailySum: 200 },
    ])
  })
})

describe('rawRows', () => {
  it('files dailies under their date and totals, with their growth, under the day they arrived', () => {
    const rows = rawRows(
      instance({
        execs: [
          daily('2026-08-10', 5, 'a', '2026-08-11T06:00:00Z'),
          cumulative('2026-08-11T06:00:00Z', 100, 'a'),
          daily('2026-08-11', 7, 'b', '2026-08-12T06:00:00Z'),
          cumulative('2026-08-12T06:00:00Z', 107, 'b'),
          daily('2026-08-11', 9, 'clone', '2026-08-12T09:00:00Z'),
        ],
      }),
    )

    expect(rows).toEqual([
      {
        day: '2026-08-12',
        values: new Map([['execs:cumulative', [{ value: 107, delta: 7 }]]]),
        received: ['2026-08-12T06:00:00Z', '2026-08-12T09:00:00Z'],
      },
      {
        day: '2026-08-11',
        values: new Map([
          ['execs:cumulative', [{ value: 100, delta: undefined }]],
          ['execs:daily', [{ value: 7 }, { value: 9 }]],
        ]),
        received: ['2026-08-11T06:00:00Z'],
      },
      { day: '2026-08-10', values: new Map([['execs:daily', [{ value: 5 }]]]), received: [] },
    ])
  })
})

describe('anomaliesByCell', () => {
  it('files a duplicate under its daily, and a total under the day it arrived', () => {
    const cells = anomaliesByCell([
      {
        type: 'duplicate-day',
        name: 'execs',
        date: '2026-08-10',
        count: 2,
        batchIds: ['a', 'b'],
      },
      {
        type: 'cumulative-regression',
        name: 'execs',
        from: 9,
        to: 5,
        receivedAt: '2026-08-12T06:00:00Z',
      },
    ])

    expect([...cells.keys()]).toEqual(['2026-08-10|execs:daily', '2026-08-12|execs:cumulative'])
  })
})
