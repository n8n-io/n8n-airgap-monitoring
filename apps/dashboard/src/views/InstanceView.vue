<script setup lang="ts">
import { computed } from 'vue'
import InstanceReport from '@/components/InstanceReport.vue'
import { useReport } from '@/composables/useReport'

const props = defineProps<{ instanceId: string }>()

const { summaries } = useReport()
const summary = computed(() =>
  summaries.value.find(({ instance }) => instance.instanceId === props.instanceId),
)
</script>

<template>
  <div class="stack">
    <RouterLink :to="{ name: 'dashboard' }" class="back">← All instances</RouterLink>
    <InstanceReport v-if="summary" :summary="summary" />
    <p v-else class="card">No instance {{ instanceId }} in this report.</p>
  </div>
</template>
