<script setup lang="ts">
import type { ChartData, ChartOptions } from 'chart.js'
import { computed } from 'vue'
import { Chart } from 'vue-chartjs'
import { chartTheme } from '@/utils/chartTheme'
import { formatDay, formatNumber } from '@/utils/format'
import { type DayGrowth, daysFrom } from '@/utils/report'

/**
 * Each number on the day it is about: a total's growth on the day it arrived, which it counts,
 * and a daily on the day whose growth covers it. A weekly batch is one bar for its seven days.
 */
const props = defineProps<{ growth: Map<string, DayGrowth>; from: string; to: string }>()
const emit = defineEmits<{ selectDay: [day: string] }>()

const days = computed(() => daysFrom(props.from, props.to))

function dayLabel(index: number): string {
  const day = days.value[index]
  return day === undefined ? '' : formatDay(day)
}

const hasGrowth = computed(() =>
  [...props.growth.values()].some(({ growth }) => growth !== undefined),
)

function window(dates: string[]): string {
  const first = dates[0]
  const last = dates[dates.length - 1]
  if (first === undefined || last === undefined) {
    return ''
  }
  return first === last
    ? formatDay(first)
    : `${formatDay(first)} – ${formatDay(last)} (${dates.length} days)`
}

// Points only on the days with a number, so hovering or clicking anywhere snaps to the
// nearest one instead of an empty day. A category axis takes the label as x, which
// Chart.js's types do not allow for, hence the casts.
interface Point {
  x: string
  y: number
}

const dayOf = (raw: unknown) => (raw as Point).x
const points = (values: Point[]) => values as unknown as number[]

const data = computed<ChartData<'bar' | 'line', number[], string>>(() => {
  const entries = [...props.growth]
  const grown = entries.flatMap(([day, entry]) =>
    entry.growth === undefined ? [] : [{ day, entry, growth: entry.growth }],
  )
  return {
    labels: days.value,
    datasets: [
      {
        type: 'bar',
        label: 'Total grew by',
        data: points(grown.map(({ day, growth }) => ({ x: day, y: growth }))),
        backgroundColor: grown.map(({ entry }) =>
          entry.batches.some(({ mismatch, growth }) => mismatch || growth < 0)
            ? chartTheme.value.critical
            : chartTheme.value.series,
        ),
        maxBarThickness: 24,
        borderRadius: 4,
        borderSkipped: 'start',
        order: 2,
      },
      {
        type: 'line',
        label: 'Daily values of the same days add up to',
        data: points(
          entries.flatMap(([day, { dailySum }]) =>
            dailySum === undefined ? [] : [{ x: day, y: dailySum }],
          ),
        ),
        showLine: false,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBorderWidth: 2,
        pointBorderColor: chartTheme.value.surface,
        pointBackgroundColor: chartTheme.value.series2,
        order: 1,
      },
    ],
  }
})

function describe(day: string): string[] {
  const entry = props.growth.get(day)
  if (entry === undefined) {
    return []
  }
  const { growth, dailySum, dailyDays } = entry
  if (growth === undefined) {
    return [
      `Daily ${formatNumber(dailySum ?? 0)}`,
      '  no growth of the total covers this day to compare',
    ]
  }
  return [
    `Total grew by ${formatNumber(growth)}`,
    ...(dailySum === undefined
      ? []
      : [
          `Dailies for ${window(dailyDays)} add up to ${formatNumber(dailySum)}`,
          `  difference ${formatNumber(growth - dailySum)}`,
        ]),
    ...(dailyDays.includes(day) ? [] : ['  not checked yet: this day has no daily']),
  ]
}

const options = computed<ChartOptions<'bar' | 'line'>>(() => ({
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'nearest', axis: 'x', intersect: false },
  onClick: (_event, elements) => {
    const element = elements[0]
    const raw = element && data.value.datasets[element.datasetIndex]?.data[element.index]
    if (raw !== undefined) {
      emit('selectDay', dayOf(raw))
    }
  },
  plugins: {
    legend: {
      position: 'top',
      align: 'end',
      labels: { color: chartTheme.value.text, usePointStyle: true, boxWidth: 8, boxHeight: 8 },
    },
    tooltip: {
      // A day with a bar and a dot has two items; describe it once.
      filter: (item, index, items) =>
        items.findIndex((other) => dayOf(other.raw) === dayOf(item.raw)) === index,
      callbacks: {
        title: ([item]) => (item === undefined ? '' : formatDay(dayOf(item.raw))),
        label: (item) => describe(dayOf(item.raw)),
      },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      border: { color: chartTheme.value.border },
      ticks: {
        color: chartTheme.value.muted,
        maxRotation: 0,
        autoSkipPadding: 24,
        callback: (_value, index) => dayLabel(index).replace(/ \d{4}$/, ''),
      },
    },
    y: {
      grid: { color: chartTheme.value.grid },
      border: { display: false },
      ticks: {
        color: chartTheme.value.muted,
        maxTicksLimit: 6,
        callback: (value) => formatNumber(Number(value)),
      },
    },
  },
}))
</script>

<template>
  <div class="chart">
    <Chart v-if="hasGrowth" type="bar" :data="data" :options="options" />
    <p v-else class="muted empty">Needs at least two reports.</p>
  </div>
</template>
