<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import type { MetricHistory } from '@/api-client/types'
import type { MetricHistoryTarget } from '@/composables/useMetricHistory'
import { formatReceivedAt } from '@/utils/formatDate'

defineProps<{
  target: MetricHistoryTarget | null
  history: MetricHistory | null
  isLoading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <CollapsibleRoot
    class="history-panel"
    :open="target !== null"
    @update:open="(open) => !open && emit('close')"
  >
    <div v-if="target" class="history-header">
      <h2>
        {{ target.instanceId }} — {{ target.metricName }}
        <template v-if="history">({{ history.kind }})</template>
      </h2>
      <CollapsibleTrigger as="button" type="button">Close</CollapsibleTrigger>
    </div>

    <CollapsibleContent class="history-content">
      <p v-if="isLoading">Loading…</p>
      <p v-else-if="error" class="error" role="alert">Could not load history: {{ error }}</p>
      <template v-else-if="history">
        <table class="history-table">
          <thead>
            <tr v-if="history.kind === 'daily'">
              <th>Date</th>
              <th>Value</th>
              <th>Batch ID</th>
            </tr>
            <tr v-else>
              <th>Received At</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="history.points.length === 0">
              <td class="empty-state" :colspan="history.kind === 'daily' ? 3 : 2">
                No data points reported yet.
              </td>
            </tr>
            <template v-else-if="history.kind === 'daily'">
              <tr v-for="point in history.points" :key="point.batchId">
                <td>{{ formatReceivedAt(point.date, false) }}</td>
                <td>{{ point.value }}</td>
                <td>{{ point.batchId }}</td>
              </tr>
            </template>
            <template v-else>
              <tr v-for="point in history.points" :key="point.receivedAt">
                <td>{{ formatReceivedAt(point.receivedAt) }}</td>
                <td>{{ point.value }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </template>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style scoped>
.history-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-xs);
  padding: 1rem;
  margin: 0.875rem;
  max-height: 400px;
  display: flex;
  flex-direction: column;
}

/* Only the table scrolls, so the header stays visible while the panel is capped. */
.history-content {
  overflow-y: auto;
  min-height: 0;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.history-header h2 {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-text-muted);
  word-break: break-all;
}

.history-table {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

/* Tables clip children unreliably, so the corners are rounded per header cell
   instead of with overflow: hidden on the table itself. */
.history-table th:first-child {
  border-top-left-radius: var(--radius-sm);
}

.history-table th:last-child {
  border-top-right-radius: var(--radius-sm);
}

.empty-state {
  color: var(--color-text-muted);
  text-align: center;
  padding: 1.5rem;
}

.error {
  color: var(--color-danger);
}
</style>
