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
      <h1>Instance reports</h1>
      <button type="button" @click="onLogout">Log out</button>
    </header>

    <p v-if="isLoading">Loading…</p>
    <p v-else-if="error" class="error" role="alert">Could not load instance reports: {{ error }}</p>
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
  padding: 1.5rem;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.error {
  color: #b91c1c;
}
</style>
