<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import InstancesTable from '@/components/InstancesTable.vue'
import { useAuth } from '@/composables/useAuth'
import { useInstanceReports } from '@/composables/useInstanceReports'
import { useMetricHistory } from '@/composables/useMetricHistory'

const router = useRouter()
const { isAuthenticated, logOut } = useAuth()
const { instances, metricNames, isLoading, error, load } = useInstanceReports()
const history = useMetricHistory()

onMounted(load)

// Covers a secret that stops working mid-session (e.g. rotated on the
// server): the composables log out on a 401, this is what then navigates.
watch(isAuthenticated, (authenticated) => {
  if (!authenticated) {
    void router.replace({ name: 'login' })
  }
})

function onLogout(): void {
  logOut()
}
</script>

<template>
  <main class="dashboard">
    <header class="dashboard-header">
      <div>
        <h1>Instance reports</h1>
        <p class="dashboard-subtitle">Latest metrics reported by each air-gapped instance.</p>
      </div>
      <button type="button" @click="onLogout">Log out</button>
    </header>

    <p v-if="isLoading" class="status">Loading…</p>
    <p v-else-if="error" class="status error" role="alert">
      Could not load instance reports: {{ error }}
    </p>
    <InstancesTable
      v-else
      :instances="instances"
      :metric-names="metricNames"
      :active-target="history.target.value"
      :history="history.history.value"
      :is-history-loading="history.isLoading.value"
      :history-error="history.error.value"
      @select-metric="history.open"
      @close-history="history.close"
    />
  </main>
</template>

<style scoped>
.dashboard {
  max-width: 90rem;
  margin: 0 auto;
  padding: 2rem 1.5rem 3rem;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.dashboard-subtitle {
  color: var(--color-text-muted);
  margin-top: 0.25rem;
}

.status {
  color: var(--color-text-muted);
  padding: 1.5rem;
  text-align: center;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.error {
  color: var(--color-danger);
  background: var(--color-danger-soft);
  border-color: transparent;
  box-shadow: none;
}
</style>
