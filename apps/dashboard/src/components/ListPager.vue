<script setup lang="ts">
import { computed } from 'vue'
import { formatNumber } from '@/utils/format'

const props = defineProps<{ total: number; pageSize: number }>()
const page = defineModel<number>({ required: true })

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const from = computed(() => (props.total === 0 ? 0 : page.value * props.pageSize + 1))
const to = computed(() => Math.min(props.total, (page.value + 1) * props.pageSize))
</script>

<template>
  <div v-if="total > pageSize" class="pager">
    <span class="muted"
      >{{ formatNumber(from) }}–{{ formatNumber(to) }} of {{ formatNumber(total) }}</span
    >
    <button type="button" :disabled="page === 0" @click="page--">Previous</button>
    <button type="button" :disabled="page >= pages - 1" @click="page++">Next</button>
  </div>
</template>
