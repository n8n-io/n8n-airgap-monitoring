<script setup lang="ts">
import type { MetricHistory } from '@/api-client/types'
import type { MetricHistoryTarget } from '@/composables/useMetricHistory'

defineProps<{
  target: MetricHistoryTarget
  history: MetricHistory | null
  isLoading: boolean
  error: string | null
}>()

defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="history-panel">
    <div class="history-header">
      <h2>
        {{ target.instanceId }} — {{ target.metricName }}
        <template v-if="history">({{ history.kind }})</template>
      </h2>
      <button type="button" @click="$emit('close')">Close</button>
    </div>

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
              <td>{{ point.date }}</td>
              <td>{{ point.value }}</td>
              <td>{{ point.batchId }}</td>
            </tr>
          </template>
          <template v-else>
            <tr v-for="point in history.points" :key="point.receivedAt">
              <td>{{ point.receivedAt }}</td>
              <td>{{ point.value }}</td>
            </tr>
          </template>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped>
.history-panel {
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
  padding: 1rem;
  margin-top: 1rem;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-table {
  border-collapse: collapse;
  width: 100%;
  margin-top: 0.5rem;
}

.history-table th,
.history-table td {
  border: 1px solid #d1d5db;
  padding: 0.5rem 0.75rem;
  text-align: left;
}

.empty-state {
  color: #9ca3af;
  text-align: center;
}

.error {
  color: #b91c1c;
}
</style>
