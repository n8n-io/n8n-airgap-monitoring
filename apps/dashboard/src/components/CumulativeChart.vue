<script setup lang="ts">
import type { ChartData, ChartOptions } from 'chart.js'
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import { chartTheme } from '@/utils/chartTheme'
import { formatDay, formatNumber, formatTimestamp } from '@/utils/format'
import { type CumulativePoint, utcDay } from '@/utils/report'

/** In receipt order. A total lower than the one before it is marked as a regression. */
const props = defineProps<{ points: CumulativePoint[] }>()
const emit = defineEmits<{ selectDay: [day: string] }>()

const regressed = computed(() =>
  props.points.map((point, i) => {
    const previous = props.points[i - 1]
    return previous !== undefined && point.value < previous.value
  }),
)

const data = computed<ChartData<'line', { x: number; y: number }[]>>(() => ({
  datasets: [
    {
      data: props.points.map((point) => ({ x: Date.parse(point.receivedAt), y: point.value })),
      borderColor: chartTheme.value.series,
      borderWidth: 2,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBorderWidth: 2,
      pointBorderColor: chartTheme.value.surface,
      pointBackgroundColor: regressed.value.map((down) =>
        down ? chartTheme.value.critical : chartTheme.value.series,
      ),
    },
  ],
}))

const options = computed<ChartOptions<'line'>>(() => ({
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'nearest', axis: 'x', intersect: false },
  onClick: (_event, elements) => {
    const point = props.points[elements[0]?.index ?? -1]
    if (point !== undefined) {
      emit('selectDay', utcDay(point.receivedAt))
    }
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title: ([item]) => {
          const point = props.points[item?.dataIndex ?? -1]
          return point === undefined ? '' : formatTimestamp(point.receivedAt)
        },
        label: (item) => {
          const point = props.points[item.dataIndex]
          if (point === undefined) {
            return ''
          }
          const down = regressed.value[item.dataIndex] ? ' (dropped)' : ''
          return `${formatNumber(point.value)}${down}`
        },
      },
    },
  },
  scales: {
    x: {
      type: 'linear',
      min: Date.parse(props.points[0]?.receivedAt ?? ''),
      max: Date.parse(props.points[props.points.length - 1]?.receivedAt ?? ''),
      grid: { display: false },
      border: { color: chartTheme.value.border },
      ticks: {
        color: chartTheme.value.muted,
        maxRotation: 0,
        maxTicksLimit: 8,
        callback: (value) =>
          formatDay(utcDay(new Date(Number(value)).toISOString())).replace(/ \d{4}$/, ''),
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
    <Line :data="data" :options="options" />
  </div>
</template>
