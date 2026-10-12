<script setup lang="ts">
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
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
  { value: '30', days: 30, label: '30 days' },
  { value: '90', days: 90, label: '90 days' },
  { value: 'all', days: undefined, label: 'All' },
] as const

const statusFilter = ref<StatusFilter>('all')
const rangeValue = ref<(typeof RANGES)[number]['value']>('90')
const range = computed(() => RANGES.find(({ value }) => value === rangeValue.value)?.days)

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
</script>

<template>
  <div class="stack">
    <ToggleGroupRoot
      type="single"
      class="tiles"
      aria-label="Filter instances"
      :model-value="statusFilter === 'all' ? undefined : statusFilter"
      @update:model-value="(value) => (statusFilter = (value as StatusFilter | undefined) ?? 'all')"
    >
      <ToggleGroupItem
        v-for="tile in tiles"
        :key="tile.filter"
        :value="tile.filter"
        :class="['tile', `tile-${tile.filter}`]"
      >
        <span :class="['status-dot', `status-${tile.filter}`]" aria-hidden="true"></span>
        <span class="tile-value">{{ formatNumber(tile.value) }}</span>
        <span class="tile-label">{{ tile.label }}</span>
      </ToggleGroupItem>
    </ToggleGroupRoot>

    <section v-if="metric" class="card">
      <header class="card-header">
        <h2>
          Daily
          <select
            v-if="metricNames.length > 1"
            v-model="selectedMetric"
            class="inline-select"
            aria-label="Daily metric"
          >
            <option v-for="name in metricNames" :key="name" :value="name">{{ name }}</option>
          </select>
          <template v-else>{{ metric }}</template>
          <span class="muted"> across all instances</span>
        </h2>
        <ToggleGroupRoot
          type="single"
          class="chips"
          aria-label="Range"
          :model-value="rangeValue"
          @update:model-value="(value) => value && (rangeValue = value as typeof rangeValue)"
        >
          <ToggleGroupItem
            v-for="option in RANGES"
            :key="option.value"
            :value="option.value"
            class="chip"
          >
            {{ option.label }}
          </ToggleGroupItem>
        </ToggleGroupRoot>
      </header>
      <DailyChart :values="daily" :from="from" :to="to" />
    </section>

    <InstancesTable :status="statusFilter" :summaries="summaries" />
  </div>
</template>
