<script setup lang="ts">
import type { InstanceSummary } from '@/api-client/types'

defineProps<{
  instances: InstanceSummary[]
  metricNames: string[]
}>()

const emit = defineEmits<{
  selectMetric: [instanceId: string, metricName: string]
}>()
</script>

<template>
  <p v-if="instances.length === 0" class="empty-state">No instances have reported yet.</p>
  <table v-else class="instances-table">
    <thead>
      <tr>
        <th>Instance</th>
        <th>Version</th>
        <th>Last report</th>
        <th v-for="name in metricNames" :key="name">{{ name }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="instance in instances" :key="instance.instanceId">
        <td>{{ instance.label ?? instance.instanceId }}</td>
        <td>{{ instance.n8nVersion }}</td>
        <td>{{ instance.receivedAt }}</td>
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
    </tbody>
  </table>
</template>

<style scoped>
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
</style>
