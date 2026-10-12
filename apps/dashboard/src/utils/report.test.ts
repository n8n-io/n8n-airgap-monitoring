import { describe, expect, it } from 'vitest'
import {
  addDays,
  anomaliesByCell,
  type CumulativePoint,
  type DailyPoint,
  daysFrom,
  findAnomalies,
  type InstanceReportEntry,
  latestPoint,
  metricColumns,
  type ReportedMetric,
  rawRows,
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

type Batch = [receivedAt: string, dailies: Record<string, number>, total: number]

function batches(...rows: Batch[]): ReportedMetric[] {
  return rows.flatMap(([receivedAt, dailies, total], i) => [
    ...Object.entries(dailies).map(([date, value]) =>
      daily(date, value, `batch-${i + 1}`, receivedAt),
    ),
    cumulative(receivedAt, total, `batch-${i + 1}`),
  ])
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
  const daysOld = (days: number) => `${addDays('2026-08-20', -days)}T12:00:00.000Z`

  it.each([
    [0, 'active'],
    [14, 'active'],
    [15, 'stale'],
    [30, 'stale'],
    [31, 'offline'],
  ])('when the last report is %i days old, then the status is %s', (days, status) => {
    expect(statusOf(daysOld(days), generatedAt)).toBe(status)
  })
})

describe('metricColumns', () => {
  it('when instances report the same metric, then the metric is listed once', () => {
    const metrics = metricColumns([
      instance({ billableExecutions: [daily('2026-08-01', 1)] }),
      instance({ billableExecutions: [daily('2026-08-01', 2)] }),
    ])

    expect(metrics).toEqual([{ name: 'billableExecutions', kinds: ['daily'] }])
  })

  it('when instances report a metric in different kinds, then the metric has every kind', () => {
    const metrics = metricColumns([
      instance({ billableExecutions: [daily('2026-08-01', 1)] }),
      instance({ billableExecutions: [cumulative('2026-08-02T06:00:00Z', 1)] }),
    ])

    expect(metrics).toEqual([{ name: 'billableExecutions', kinds: ['daily', 'cumulative'] }])
  })

  it('when no instance reports dailies of a metric, then the metric has only totals', () => {
    const metrics = metricColumns([
      instance({ activeWorkflows: [cumulative('2026-08-02T06:00:00Z', 1)] }),
    ])

    expect(metrics).toEqual([{ name: 'activeWorkflows', kinds: ['cumulative'] }])
  })

  it('when instances report different metrics, then the metrics are sorted by name', () => {
    const metrics = metricColumns([
      instance({ billableExecutions: [daily('2026-08-01', 1)] }),
      instance({ activeWorkflows: [cumulative('2026-08-02T06:00:00Z', 1)] }),
    ])

    expect(metrics.map(({ name }) => name)).toEqual(['activeWorkflows', 'billableExecutions'])
  })
})

describe('latestPoint', () => {
  it('when totals are out of order, then the latest is the last received', () => {
    const points = [
      cumulative('2026-01-01T06:00:00Z', 5),
      cumulative('2026-03-03T06:00:00Z', 3),
      cumulative('2026-02-02T06:00:00Z', 2),
    ]

    expect(latestPoint(points)?.value).toBe(3)
  })

  it('when an older day arrives after a newer day, then the latest daily is the newer day', () => {
    const points = [
      daily('2026-08-03', 9, 'batch-1', '2026-08-04T06:00:00Z'),
      daily('2026-08-02', 8, 'backfill', '2026-08-05T06:00:00Z'),
    ]

    expect(latestPoint(points)?.value).toBe(9)
  })

  it('when a day has two dailies, then the latest is the last received', () => {
    const points = [
      daily('2026-08-03', 4, 'batch-2', '2026-08-04T09:00:00Z'),
      daily('2026-08-03', 9, 'batch-1', '2026-08-04T06:00:00Z'),
    ]

    expect(latestPoint(points)?.value).toBe(4)
  })

  it('when there are no points, then there is no latest', () => {
    expect(latestPoint([])).toBeUndefined()
  })
})

describe('findAnomalies', () => {
  describe('the same day twice', () => {
    it('when each day is reported once, then there is no anomaly', () => {
      const execs = [daily('2026-08-20', 1, 'a'), daily('2026-08-21', 1, 'b')]

      expect(findAnomalies(instance({ execs }))).toEqual([])
    })

    it('when a day is reported in two batches, then it is an anomaly', () => {
      const execs = [daily('2026-08-20', 1, 'a'), daily('2026-08-20', 1, 'b')]

      expect(findAnomalies(instance({ execs }))).toEqual([
        {
          type: 'duplicate-day',
          name: 'execs',
          date: '2026-08-20',
          count: 2,
          batchIds: ['a', 'b'],
        },
      ])
    })

    it('when a day is reported twice in one batch, then it is an anomaly', () => {
      const execs = [daily('2026-08-20', 1, 'a'), daily('2026-08-20', 1, 'a')]

      expect(findAnomalies(instance({ execs }))).toEqual([
        { type: 'duplicate-day', name: 'execs', date: '2026-08-20', count: 2, batchIds: ['a'] },
      ])
    })
  })

  describe('total goes down', () => {
    it('when a total stays the same, then there is no anomaly', () => {
      const execs = [
        cumulative('2026-08-01T06:00:00Z', 100),
        cumulative('2026-08-02T06:00:00Z', 100),
      ]

      expect(findAnomalies(instance({ execs }))).toEqual([])
    })

    it('when a total goes down, then it is an anomaly', () => {
      const execs = [
        cumulative('2026-08-01T06:00:00Z', 100),
        cumulative('2026-08-02T06:00:00Z', 99),
      ]

      expect(findAnomalies(instance({ execs }))).toEqual([
        {
          type: 'cumulative-regression',
          name: 'execs',
          from: 100,
          receivedAt: '2026-08-02T06:00:00Z',
        },
      ])
    })
  })

  // A total also counts the day the batch is made, which has no daily yet. So the growth of a
  // total may differ from the dailies of its batch by up to one day: the largest daily around.
  describe('total against daily', () => {
    it('when a total grows by its dailies plus one day, then there is no anomaly', () => {
      const execs = batches(
        ['2026-03-01T06:00Z', { '2026-02-28': 100 }, 1000],
        ['2026-03-02T06:00Z', { '2026-03-01': 100 }, 1200],
        ['2026-03-03T06:00Z', { '2026-03-02': 100 }, 1300],
      )

      expect(findAnomalies(instance({ execs }))).toEqual([])
    })

    it('when a total grows by more than its dailies plus one day, then it is an anomaly', () => {
      const execs = batches(
        ['2026-03-01T06:00Z', { '2026-02-28': 100 }, 1000],
        ['2026-03-02T06:00Z', { '2026-03-01': 100 }, 1201],
        ['2026-03-03T06:00Z', { '2026-03-02': 100 }, 1301],
      )

      expect(findAnomalies(instance({ execs }))).toEqual([
        {
          type: 'cumulative-daily-mismatch',
          name: 'execs',
          cumulativeDelta: 201,
          dailySum: 100,
          fromDate: '2026-03-01',
          toDate: '2026-03-01',
          receivedAt: '2026-03-02T06:00Z',
        },
      ])
    })

    it('when a batch is the latest, then its total is not checked', () => {
      const execs = batches(
        ['2026-03-01T06:00Z', { '2026-02-28': 100 }, 1000],
        ['2026-03-02T06:00Z', { '2026-03-01': 100 }, 5000],
      )

      expect(findAnomalies(instance({ execs }))).toEqual([])
    })

    it('when a batch has a week of dailies, then its total is compared with their sum', () => {
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
        ['2026-03-01T06:00Z', { '2026-02-28': 100 }, 1000],
        ['2026-03-08T06:00Z', week, 1801],
        ['2026-03-09T06:00Z', { '2026-03-08': 100 }, 1901],
      )

      expect(findAnomalies(instance({ execs }))).toEqual([
        {
          type: 'cumulative-daily-mismatch',
          name: 'execs',
          cumulativeDelta: 801,
          dailySum: 700,
          fromDate: '2026-03-01',
          toDate: '2026-03-07',
          receivedAt: '2026-03-08T06:00Z',
        },
      ])
    })

    it('when a busy day was long ago, then it does not allow more difference today', () => {
      const execs = batches(
        ['2026-03-01T06:00Z', { '2026-02-28': 5000 }, 10_000],
        ['2026-03-02T06:00Z', { '2026-03-01': 100 }, 10_100],
        ['2026-03-03T06:00Z', { '2026-03-02': 100 }, 10_301],
        ['2026-03-04T06:00Z', { '2026-03-03': 100 }, 10_401],
      )

      expect(findAnomalies(instance({ execs }))).toEqual([
        {
          type: 'cumulative-daily-mismatch',
          name: 'execs',
          cumulativeDelta: 201,
          dailySum: 100,
          fromDate: '2026-03-02',
          toDate: '2026-03-02',
          receivedAt: '2026-03-03T06:00Z',
        },
      ])
    })
  })
})

describe('daysFrom', () => {
  it('when the range crosses the end of a month, then it lists every day', () => {
    expect(daysFrom('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ])
  })

  it('when the range ends before it starts, then it is empty', () => {
    expect(daysFrom('2026-08-02', '2026-08-01')).toEqual([])
  })
})

describe('sumDaily', () => {
  it('when instances report the same day, then their dailies are added', () => {
    const instances = [
      instance({ execs: [daily('2026-08-01', 7)] }),
      instance({ execs: [daily('2026-08-01', 10)] }),
    ]

    expect(sumDaily(instances, 'execs')).toEqual(new Map([['2026-08-01', 17]]))
  })

  it('when an instance reports a day twice, then only the last received daily is added', () => {
    const instances = [
      instance({
        execs: [
          daily('2026-08-01', 5, 'a', '2026-08-02T06:00:00Z'),
          daily('2026-08-01', 7, 'b', '2026-08-02T09:00:00Z'),
        ],
      }),
    ]

    expect(sumDaily(instances, 'execs')).toEqual(new Map([['2026-08-01', 7]]))
  })

  it('when an instance also reports totals, then the totals are not added', () => {
    const instances = [
      instance({ execs: [daily('2026-08-01', 7), cumulative('2026-08-01T06:00:00Z', 99)] }),
    ]

    expect(sumDaily(instances, 'execs')).toEqual(new Map([['2026-08-01', 7]]))
  })
})

describe('rawRows', () => {
  it('when a batch has a daily and a total, then the daily is on its day and the total on the day it arrived', () => {
    const rows = rawRows(
      instance({
        execs: [
          daily('2026-08-10', 5, 'a', '2026-08-11T06:00:00Z'),
          cumulative('2026-08-11T06:00:00Z', 100, 'a'),
        ],
      }),
    )

    expect(rows.map(({ day, values }) => ({ day, values }))).toEqual([
      { day: '2026-08-11', values: new Map([['execs:cumulative', [{ value: 100 }]]]) },
      { day: '2026-08-10', values: new Map([['execs:daily', [{ value: 5 }]]]) },
    ])
  })

  it('when there are several totals, then each total shows how much it grew', () => {
    const rows = rawRows(
      instance({
        execs: [
          cumulative('2026-08-11T06:00:00Z', 100),
          cumulative('2026-08-12T06:00:00Z', 107),
          cumulative('2026-08-13T06:00:00Z', 105),
        ],
      }),
    )

    expect(rows.map((row) => row.values.get('execs:cumulative'))).toEqual([
      [{ value: 105, delta: -2 }],
      [{ value: 107, delta: 7 }],
      [{ value: 100 }],
    ])
  })

  it('when a day has two dailies, then its row shows both', () => {
    const rows = rawRows(
      instance({
        execs: [
          daily('2026-08-11', 7, 'original', '2026-08-12T06:00:00Z'),
          daily('2026-08-11', 9, 'clone', '2026-08-12T09:00:00Z'),
        ],
      }),
    )

    expect(rows.find(({ day }) => day === '2026-08-11')?.values).toEqual(
      new Map([['execs:daily', [{ value: 7 }, { value: 9 }]]]),
    )
  })

  it('when multiple reports of one instance arrive on the same day, then the Received column of that day shows all their times', () => {
    const rows = rawRows(
      instance({
        execs: [
          daily('2026-08-11', 7, 'original', '2026-08-12T06:00:00Z'),
          daily('2026-08-11', 9, 'clone', '2026-08-12T09:00:00Z'),
        ],
      }),
    )

    expect(rows.find(({ day }) => day === '2026-08-12')?.received).toEqual([
      '2026-08-12T06:00:00Z',
      '2026-08-12T09:00:00Z',
    ])
  })
})

describe('anomaliesByCell', () => {
  it('when a day is reported twice, then the anomaly is in the daily cell of that day', () => {
    const cells = anomaliesByCell([
      { type: 'duplicate-day', name: 'execs', date: '2026-08-10', count: 2, batchIds: ['a', 'b'] },
    ])

    expect([...cells.keys()]).toEqual(['2026-08-10|execs:daily'])
  })

  it('when a total goes down, then the anomaly is in the total cell of the day it arrived', () => {
    const cells = anomaliesByCell([
      {
        type: 'cumulative-regression',
        name: 'execs',
        from: 9,
        receivedAt: '2026-08-12T06:00:00Z',
      },
    ])

    expect([...cells.keys()]).toEqual(['2026-08-12|execs:cumulative'])
  })
})
