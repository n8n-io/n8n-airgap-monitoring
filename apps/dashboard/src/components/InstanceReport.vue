<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import CumulativeChart from './CumulativeChart.vue'
import DailyChart from './DailyChart.vue'
import GrowthChart from './GrowthChart.vue'
import RawTable from './RawTable.vue'
import StatusBadge from './StatusBadge.vue'
import { formatTimestamp } from '@/utils/format'
import {
  anomaliesByCell,
  type CumulativePoint,
  dailyValues,
  growthPerBatch,
  metricColumns,
  rawRows,
  utcDay,
} from '@/utils/report'
import { displayName, type InstanceSummary } from '@/utils/summary'

const props = defineProps<{ summary: InstanceSummary }>()

const selectedDay = ref<string>()
const showJson = ref(false)
const copied = ref(false)

watch(
  () => props.summary,
  () => {
    selectedDay.value = undefined
    showJson.value = false
  },
)

const instance = computed(() => props.summary.instance)
const columns = computed(() => metricColumns([instance.value]))

const metrics = computed(() =>
  Object.entries(instance.value.dataPoints)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, points]) => {
      const daily = points.some((point) => point.kind === 'daily') ? dailyValues(points) : undefined
      const cumulative = points.filter(
        (point): point is CumulativePoint => point.kind === 'cumulative',
      )
      // Shared by the day charts, so their days line up one above the other.
      const days = [
        ...(daily?.keys() ?? []),
        ...cumulative.map((point) => utcDay(point.receivedAt)),
      ].sort()
      return {
        name,
        daily,
        cumulative,
        growth: daily !== undefined && cumulative.length > 1 ? growthPerBatch(points) : undefined,
        from: days[0] ?? '',
        to: days[days.length - 1] ?? '',
      }
    }),
)

const rows = computed(() => rawRows(instance.value))
const anomalies = computed(() => anomaliesByCell(props.summary.anomalies))

/** From a click on a chart: brings that day's row of the raw data into view. */
async function selectDay(day: string): Promise<void> {
  showJson.value = false
  selectedDay.value = day
  await nextTick()
  document.getElementById(`raw-${day}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function copyId(): Promise<void> {
  await navigator.clipboard.writeText(instance.value.instanceId)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1500)
}
</script>

<template>
  <div class="stack">
    <section class="card instance-header">
      <div>
        <h1>{{ displayName(instance) }}</h1>
        <p class="id-line">
          <span class="mono">{{ instance.instanceId }}</span>
          <button type="button" class="link-button" @click="copyId">
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </p>
        <p class="muted">
          First seen {{ formatTimestamp(instance.firstSeen) }} · last report
          {{ formatTimestamp(instance.lastReportAt) }}
        </p>
      </div>
      <StatusBadge :status="summary.status" />
    </section>

    <section v-for="metric in metrics" :key="metric.name" class="card">
      <h2>
        {{ metric.name }}
        <span class="muted">· click a point to see that day in the raw data</span>
      </h2>
      <div class="charts">
        <div v-if="metric.daily">
          <h3>Daily</h3>
          <DailyChart
            :values="metric.daily"
            :from="metric.from"
            :to="metric.to"
            @select-day="selectDay"
          />
        </div>
        <div v-if="metric.growth">
          <h3>
            Total vs daily, per batch
            <span class="muted">
              · on the day a batch arrived: how much the total grew, and what the dailies it covers
              add up to. Red: they differ, or the total dropped
            </span>
          </h3>
          <GrowthChart
            :growth="metric.growth"
            :from="metric.from"
            :to="metric.to"
            @select-day="selectDay"
          />
        </div>
        <div v-if="metric.cumulative.length > 0">
          <h3>Running total <span class="muted">· one point per batch</span></h3>
          <CumulativeChart :points="metric.cumulative" @select-day="selectDay" />
        </div>
      </div>
    </section>

    <section id="raw-data" class="card">
      <header class="card-header">
        <h2>Raw data</h2>
        <button
          type="button"
          :class="['chip', { selected: showJson }]"
          @click="showJson = !showJson"
        >
          JSON
        </button>
      </header>
      <pre v-if="showJson" class="json">{{ JSON.stringify(instance, null, 2) }}</pre>
      <p v-else class="muted raw-note">
        A daily value is listed under its day, a total under the day it arrived. Hover a pink cell
        to see what is wrong with it.
      </p>
      <RawTable
        v-if="!showJson"
        :columns="columns"
        :rows="rows"
        :anomalies="anomalies"
        :selected-day="selectedDay"
      />
    </section>
  </div>
</template>
