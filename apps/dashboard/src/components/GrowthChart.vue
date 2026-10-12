<script setup lang="ts">
import type { ChartData, ChartOptions } from 'chart.js'
import { computed } from 'vue'
import { Chart } from 'vue-chartjs'
import { chartTheme } from '@/utils/chartTheme'
import { formatDay, formatNumber } from '@/utils/format'
import { daysFrom, type BatchGrowth, utcDay } from '@/utils/report'

/** Each report is drawn on the day it arrived; a weekly batch is one bar for its seven days. */
const props = defineProps<{ growth: BatchGrowth[]; from: string; to: string }>()
const emit = defineEmits<{ selectDay: [day: string] }>()

const days = computed(() => daysFrom(props.from, props.to))

function dayLabel(index: number): string {
  const day = days.value[index]
  return day === undefined ? '' : formatDay(day)
}

const byArrival = computed(() => {
  const reports = new Map<string, BatchGrowth[]>()
  for (const report of props.growth) {
    const day = utcDay(report.point.receivedAt)
    reports.set(day, [...(reports.get(day) ?? []), report])
  }
  return reports
})

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

function window(report: BatchGrowth): string {
  const first = report.days[0]
  const last = report.days[report.days.length - 1]
  if (first === undefined || last === undefined) {
    return ''
  }
  return first === last
    ? formatDay(first)
    : `${formatDay(first)} – ${formatDay(last)} (${report.days.length} days)`
}

// Points only on the days a batch arrived, so hovering or clicking anywhere snaps to the
// nearest batch instead of an empty day. A category axis takes the label as x, which
// Chart.js's types do not allow for, hence the casts.
interface Point {
  x: string
  y: number
}

const dayOf = (raw: unknown) => (raw as Point).x
const points = (values: Point[]) => values as unknown as number[]

const data = computed<ChartData<'bar' | 'line', number[], string>>(() => {
  const arrivals = [...byArrival.value].sort(([a], [b]) => a.localeCompare(b))
  return {
    labels: days.value,
    datasets: [
      {
        type: 'bar',
        label: 'Total grew by',
        data: points(
          arrivals.map(([day, reports]) => ({
            x: day,
            y: sum(reports.map(({ growth }) => growth)),
          })),
        ),
        backgroundColor: arrivals.map(([, reports]) =>
          reports.some(({ mismatch, growth }) => mismatch || growth < 0)
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
          arrivals.map(([day, reports]) => ({
            x: day,
            y: sum(reports.map(({ dailySum }) => dailySum)),
          })),
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
      filter: (item) => item.datasetIndex === 0,
      callbacks: {
        title: ([item]) => (item === undefined ? '' : `Arrived ${formatDay(dayOf(item.raw))}`),
        label: (item) =>
          (byArrival.value.get(dayOf(item.raw)) ?? []).flatMap((report) => [
            `Batch for ${window(report)}`,
            `  total grew by ${formatNumber(report.growth)}`,
            `  dailies add up to ${formatNumber(report.dailySum)}, difference ${formatNumber(report.growth - report.dailySum)}`,
            ...(report.checked ? [] : ['  not checked yet: the day it was made has no daily']),
          ]),
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
    <Chart v-if="growth.length > 0" type="bar" :data="data" :options="options" />
    <p v-else class="muted empty">Needs at least two reports.</p>
  </div>
</template>
