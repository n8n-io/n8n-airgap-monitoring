<script setup lang="ts">
import {
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from 'reka-ui'
import type { InstanceSummary, MetricHistory } from '@/api-client/types'
import type { MetricHistoryTarget } from '@/composables/useMetricHistory'
import MetricHistoryPanel from './MetricHistoryPanel.vue'

const props = defineProps<{
  instances: InstanceSummary[]
  metricNames: string[]
  activeTarget: MetricHistoryTarget | null
  history: MetricHistory | null
  isHistoryLoading: boolean
  historyError: string | null
}>()

const emit = defineEmits<{
  selectMetric: [instanceId: string, metricName: string]
  closeHistory: []
}>()

const columnCount = 3 + props.metricNames.length

// Month spelled out (not numeric) so the date reads the same regardless of
// whether a country orders day/month or month/day.
const receivedAtFormatter = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatReceivedAt(receivedAt: string): string {
  const date = new Date(receivedAt)
  return Number.isNaN(date.getTime()) ? receivedAt : receivedAtFormatter.format(date)
}
</script>

<template>
  <p v-if="instances.length === 0" class="empty-state">No instances have reported yet.</p>
  <ScrollAreaRoot v-else class="instances-scroll-area">
    <ScrollAreaViewport class="instances-scroll-viewport">
      <table class="instances-table">
        <thead>
          <tr>
            <th class="instance-column">Instance</th>
            <th>Version</th>
            <th>Last report</th>
            <th v-for="name in metricNames" :key="name">{{ name }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="instance in instances" :key="instance.instanceId">
            <tr>
              <td class="instance-column" :title="instance.label ?? instance.instanceId">
                {{ instance.label ?? instance.instanceId }}
              </td>
              <td>{{ instance.n8nVersion }}</td>
              <td>{{ formatReceivedAt(instance.receivedAt) }}</td>
              <td v-for="name in metricNames" :key="name">
                <button
                  v-if="instance.metrics[name] !== undefined"
                  type="button"
                  class="metric-cell"
                  @click="emit('selectMetric', instance.instanceId, name)"
                >
                  {{ instance.metrics[name] }}
                </button>
                <span v-else class="empty-cell">—</span>
              </td>
            </tr>
            <tr v-if="activeTarget?.instanceId === instance.instanceId">
              <td class="history-row" :colspan="columnCount">
                <MetricHistoryPanel
                  :target="activeTarget"
                  :history="history"
                  :is-loading="isHistoryLoading"
                  :error="historyError"
                  @close="emit('closeHistory')"
                />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </ScrollAreaViewport>
    <ScrollAreaScrollbar class="instances-scrollbar" orientation="horizontal">
      <ScrollAreaThumb class="instances-scrollbar-thumb" />
    </ScrollAreaScrollbar>
  </ScrollAreaRoot>
</template>

<style scoped>
.instances-scroll-area {
  width: 100%;
}

.instances-scroll-viewport {
  width: 100%;
}

.instances-scrollbar {
  display: flex;
  height: 0.625rem;
  padding: 0.125rem;
}

.instances-scrollbar-thumb {
  flex: 1;
  background: #d1d5db;
  border-radius: 9999px;
}

.instances-table {
  border-collapse: collapse;
  width: 100%;
}

.instances-table th,
.instances-table td {
  border: 1px solid #d1d5db;
  padding: 0.5rem 0.75rem;
  text-align: left;
}

.instance-column {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-cell {
  background: none;
  border: none;
  padding: 0;
  color: #2563eb;
  cursor: pointer;
  font: inherit;
}

.empty-cell {
  color: #9ca3af;
}

.history-row {
  background: #f9fafb;
}
</style>
