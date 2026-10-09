<script setup lang="ts">
import { onMounted } from 'vue'
import { useReport } from '@/composables/useReport'
import { formatTimestamp } from '@/utils/format'

const { report, isLoading, error, load } = useReport()

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="topbar">
      <RouterLink :to="{ name: 'dashboard' }" class="title">Report inspector</RouterLink>
      <p v-if="report" class="muted">
        Generated {{ formatTimestamp(report.data.generatedAt) }} by n8n-airgap-monitoring
        {{ report.data.airgapMonitoringVersion }}
        <template v-if="report.data.filters"> · filtered by {{ report.data.filters }}</template>
      </p>
    </header>

    <main>
      <p v-if="isLoading" class="muted">Loading report…</p>
      <p v-else-if="error" class="card error" role="alert">
        Could not load the report: {{ error }}
      </p>
      <RouterView v-else-if="report" v-slot="{ Component }">
        <!-- Kept alive, so filters and pages survive a visit to an instance. -->
        <KeepAlive include="DashboardView">
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </main>
  </div>
</template>
