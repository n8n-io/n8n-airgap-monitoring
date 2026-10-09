<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { formatDay, formatNumber, formatTimestamp } from '@/utils/format'
import { columnKey, latestPoint, metricColumns, pointsOf } from '@/utils/report'
import {
  displayName,
  type InstanceSummary,
  matches,
  RECENT_ANOMALY_DAYS,
  type StatusFilter,
} from '@/utils/summary'
import ListPager from './ListPager.vue'

const props = defineProps<{ summaries: InstanceSummary[]; status: StatusFilter }>()
const router = useRouter()

const PAGE_SIZE = 50
const STATUS_TEXT = { active: 'Active', stale: 'Stale', offline: 'Offline' } as const

type SortKey = 'name' | 'lastReport'

const term = ref('')
const sortKey = ref<SortKey>('lastReport')
const page = ref(0)

const columns = computed(() => metricColumns(props.summaries.map(({ instance }) => instance)))

function statusTip({ status, daysSinceReport }: InstanceSummary): string {
  return `${STATUS_TEXT[status]}: last report ${daysSinceReport} days before the report was generated`
}

const filtered = computed(() =>
  props.summaries.filter(
    (summary) =>
      matches(summary.instance, term.value) &&
      (props.status === 'all' ||
        (props.status === 'anomaly'
          ? summary.recentAnomalies.length > 0
          : summary.status === props.status)),
  ),
)

const sorted = computed(() => {
  const byName = (a: InstanceSummary, b: InstanceSummary) =>
    displayName(a.instance).localeCompare(displayName(b.instance)) ||
    a.instance.instanceId.localeCompare(b.instance.instanceId)
  const compare: Record<SortKey, (a: InstanceSummary, b: InstanceSummary) => number> = {
    name: byName,
    lastReport: (a, b) =>
      b.instance.lastReportAt.localeCompare(a.instance.lastReportAt) || byName(a, b),
  }
  return [...filtered.value].sort(compare[sortKey.value])
})

const visible = computed(() =>
  sorted.value.slice(page.value * PAGE_SIZE, (page.value + 1) * PAGE_SIZE).map((summary) => ({
    summary,
    latest: columns.value.map((column) => ({
      key: columnKey(column),
      point: latestPoint(pointsOf(summary.instance, column)),
    })),
  })),
)

watch([term, () => props.status, sortKey, () => props.summaries], () => {
  page.value = 0
})
</script>

<template>
  <section class="card">
    <header class="card-header">
      <h2>
        Instances <span class="muted">{{ formatNumber(filtered.length) }}</span>
      </h2>
      <div class="chips">
        <input v-model="term" type="search" class="filter" placeholder="Filter by label or ID" />
      </div>
    </header>
    <div class="table-wrap">
      <table class="instances">
        <thead>
          <tr>
            <th>
              <button
                type="button"
                class="sort"
                :class="{ sorted: sortKey === 'lastReport' }"
                @click="sortKey = 'lastReport'"
              >
                Last report
              </button>
            </th>
            <th>
              <button
                type="button"
                class="sort"
                :class="{ sorted: sortKey === 'name' }"
                @click="sortKey = 'name'"
              >
                Instance
              </button>
            </th>
            <th
              v-for="column in columns"
              :key="columnKey(column)"
              class="number"
              :title="column.name"
            >
              {{ column.kind === 'daily' ? 'Daily' : 'Total' }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="{ summary, latest } in visible"
            :key="summary.instance.instanceId"
            :class="['clickable', { 'has-anomaly': summary.recentAnomalies.length > 0 }]"
            :title="
              summary.recentAnomalies.length > 0
                ? `Anomalies in the last ${RECENT_ANOMALY_DAYS} days, marked on its page`
                : undefined
            "
            @click="
              router.push({ name: 'instance', params: { instanceId: summary.instance.instanceId } })
            "
          >
            <td class="nowrap">{{ formatTimestamp(summary.instance.lastReportAt) }}</td>
            <td>
              <div class="name">
                <span
                  :class="['status-dot', `status-${summary.status}`]"
                  role="img"
                  :aria-label="statusTip(summary)"
                  :title="statusTip(summary)"
                ></span
                >{{ displayName(summary.instance) }}
              </div>
              <div class="mono muted truncate" :title="summary.instance.instanceId">
                {{ summary.instance.instanceId }}
              </div>
            </td>
            <td v-for="{ key, point } in latest" :key="key" class="number nowrap">
              <template v-if="point">
                {{ formatNumber(point.value) }}
                <span v-if="point.kind === 'daily'" class="day">{{ formatDay(point.date) }}</span>
              </template>
              <span v-else class="muted">–</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="filtered.length === 0" class="muted empty">
        {{ summaries.length === 0 ? 'No instances in this report.' : 'No instances match.' }}
      </p>
    </div>
    <ListPager v-model="page" :total="filtered.length" :page-size="PAGE_SIZE" />
  </section>
</template>
