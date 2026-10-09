<script setup lang="ts">
import { computed, ref } from 'vue'
import DailyChart from '@/components/DailyChart.vue'
import InstancesTable from '@/components/InstancesTable.vue'
import { formatNumber } from '@/utils/format'
import { addDays, dailyMetricNames, sumDaily, utcDay } from '@/utils/report'
import { useReport } from '@/composables/useReport'
import { RECENT_ANOMALY_DAYS, type StatusFilter } from '@/utils/summary'

const { report, summaries } = useReport()
const generatedAt = computed(() => report.value?.data.generatedAt ?? '')

const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: undefined, label: 'All' },
] as const

const statusFilter = ref<StatusFilter>('all')
const range = ref<number | undefined>(90)

const metricNames = computed(() =>
  dailyMetricNames(summaries.value.map(({ instance }) => instance)),
)
const selectedMetric = ref<string>()
const metric = computed(() => selectedMetric.value ?? metricNames.value[0])

const daily = computed(() =>
  metric.value === undefined
    ? new Map<string, number>()
    : sumDaily(
        summaries.value.map(({ instance }) => instance),
        metric.value,
      ),
)

// A range ends at the last full day before the report was generated.
const to = computed(() => addDays(utcDay(generatedAt.value), -1))
// Never before the first day with data, so a short report does not start with empty weeks.
const from = computed(() => {
  const first = [...daily.value.keys()].sort()[0]
  if (range.value === undefined) {
    return first
  }
  const start = addDays(to.value, 1 - range.value)
  return first !== undefined && first > start ? first : start
})

const tiles = computed(() => [
  { filter: 'all' as const, label: 'Instances', value: summaries.value.length },
  {
    filter: 'active' as const,
    label: 'Active',
    value: summaries.value.filter((s) => s.status === 'active').length,
  },
  {
    filter: 'stale' as const,
    label: 'Stale',
    value: summaries.value.filter((s) => s.status === 'stale').length,
  },
  {
    filter: 'offline' as const,
    label: 'Offline',
    value: summaries.value.filter((s) => s.status === 'offline').length,
  },
  {
    filter: 'anomaly' as const,
    label: `With anomalies in ${RECENT_ANOMALY_DAYS} days`,
    value: summaries.value.filter((s) => s.recentAnomalies.length > 0).length,
  },
])

// Clicking the selected tile again clears the filter.
function filterBy(filter: StatusFilter): void {
  statusFilter.value = statusFilter.value === filter ? 'all' : filter
}
</script>

<template>
  <div class="stack">
    <div class="tiles">
      <button
        v-for="tile in tiles"
        :key="tile.filter"
        type="button"
        :class="[
          'tile',
          `tile-${tile.filter}`,
          { selected: statusFilter === tile.filter && tile.filter !== 'all' },
        ]"
        @click="filterBy(tile.filter)"
      >
        <span :class="['status-dot', `status-${tile.filter}`]" aria-hidden="true"></span>
        <span class="tile-value">{{ formatNumber(tile.value) }}</span>
        <span class="tile-label">{{ tile.label }}</span>
      </button>
    </div>

    <section v-if="metric" class="card">
      <header class="card-header">
        <h2>
          Daily
          <select v-if="metricNames.length > 1" v-model="selectedMetric" class="inline-select">
            <option v-for="name in metricNames" :key="name" :value="name">{{ name }}</option>
          </select>
          <template v-else>{{ metric }}</template>
          <span class="muted"> across all instances</span>
        </h2>
        <div class="chips">
          <button
            v-for="option in RANGES"
            :key="option.label"
            type="button"
            :class="['chip', { selected: range === option.days }]"
            @click="range = option.days"
          >
            {{ option.label }}
          </button>
        </div>
      </header>
      <DailyChart :values="daily" :from="from" :to="to" />
    </section>

    <InstancesTable :status="statusFilter" :summaries="summaries" />
  </div>
</template>
