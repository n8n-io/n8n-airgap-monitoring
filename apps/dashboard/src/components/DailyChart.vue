<script setup lang="ts">
import type { ChartData, ChartOptions } from 'chart.js'
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import { chartTheme } from '@/utils/chartTheme'
import { formatDay, formatNumber } from '@/utils/format'
import { daysFrom } from '@/utils/report'

const props = defineProps<{
  /** Value per date. Dates without one stay empty: a gap, not a zero. */
  values: Map<string, number>
  from?: string
  to?: string
}>()

const emit = defineEmits<{ selectDay: [day: string] }>()

const days = computed(() => {
  const dates = [...props.values.keys()].sort()
  return daysFrom(props.from ?? dates[0] ?? '', props.to ?? dates[dates.length - 1] ?? '')
})

function dayLabel(index: number): string {
  const day = days.value[index]
  return day === undefined ? '' : formatDay(day)
}

const data = computed<ChartData<'bar', (number | null)[], string>>(() => ({
  labels: days.value,
  datasets: [
    {
      data: days.value.map((day) => props.values.get(day) ?? null),
      backgroundColor: chartTheme.value.series,
      hoverBackgroundColor: chartTheme.value.series,
      maxBarThickness: 24,
      borderRadius: 4,
      borderSkipped: 'start',
    },
  ],
}))

const options = computed<ChartOptions<'bar'>>(() => ({
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  onClick: (_event, elements) => {
    const day = days.value[elements[0]?.index ?? -1]
    if (day !== undefined) {
      emit('selectDay', day)
    }
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title: ([item]) => dayLabel(item?.dataIndex ?? -1),
        label: (item) => formatNumber(item.parsed.y ?? 0),
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
      beginAtZero: true,
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
    <Bar v-if="days.length > 0" :data="data" :options="options" />
    <p v-else class="muted empty">No daily values.</p>
  </div>
</template>
