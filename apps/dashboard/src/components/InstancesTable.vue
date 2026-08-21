<script setup lang="ts">
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
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
.empty-state {
  color: var(--color-text-muted);
  text-align: center;
  padding: 3rem 1.5rem;
  background: var(--color-surface);
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-lg);
}

.instances-scroll-area {
  width: 100%;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.instances-scroll-viewport {
  width: 100%;
}

.instances-scrollbar {
  display: flex;
  height: 0.625rem;
  padding: 0.125rem;
  background: var(--color-surface-muted);
  border-top: 1px solid var(--color-border);
}

.instances-scrollbar-thumb {
  flex: 1;
  background: var(--color-border-strong);
  border-radius: 9999px;
}

.instances-scrollbar-thumb:hover {
  background: var(--color-text-subtle);
}

.instances-table tbody tr:hover > td {
  background: var(--color-surface-muted);
}

.instances-table td {
  vertical-align: middle;
  white-space: nowrap;
}

.instance-column {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.metric-cell {
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  padding: 0.125rem 0.375rem;
  margin: -0.125rem -0.375rem;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-variant-numeric: tabular-nums;
}

/* No accent colour: the values read as plain data, and the hover tint plus
   pointer cursor are what signal that a cell opens its history. */
.metric-cell:hover:not(:disabled) {
  background: var(--color-border);
  border-color: transparent;
}

.empty-cell {
  color: var(--color-text-subtle);
}

.history-row {
  background: var(--color-surface-muted);
  padding: 0;
}

.instances-table tbody tr:hover > td.history-row {
  background: var(--color-surface-muted);
}
</style>
