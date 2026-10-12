<script setup lang="ts">
import type { Status } from '@/utils/report'

defineProps<{ status: Status }>()

const BADGES = {
  active: { icon: '●', text: 'Active' },
  stale: { icon: '◐', text: 'Stale' },
  offline: { icon: '○', text: 'Offline' },
} as const
</script>

<template>
  <span :class="['badge', `badge-${status}`]">
    <span class="badge-icon" aria-hidden="true">{{ BADGES[status].icon }}</span
    >{{ BADGES[status].text }}
  </span>
</template>
