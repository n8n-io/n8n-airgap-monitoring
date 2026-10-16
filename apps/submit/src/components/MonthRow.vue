<script setup lang="ts">
import { computed } from 'vue'
import type { MissingInstance, MonthRow, SendState } from '../api'
import { daysSince, formatDateTime, formatDay, formatMonth } from '../format'

const props = defineProps<{ row: MonthRow; state?: SendState; sentAt?: string }>()

type Status = 'upcoming' | 'pending' | SendState

const status = computed<Status>(() => props.state ?? (props.row.kind === 'submitted' ? 'sent' : props.row.kind))

const statusText: Record<Status, string> = {
  upcoming: 'In progress',
  pending: 'Pending',
  sending: 'Sending…',
  sent: 'Sent',
  failed: 'Not sent',
}

const deliveredAt = computed(() => props.sentAt ?? (props.row.kind === 'submitted' ? props.row.submittedAt : undefined))

function nameOf(instance: MissingInstance): string {
  return instance.label ?? instance.instanceId.slice(0, 12)
}

function lastDayText(instance: MissingInstance): string {
  return instance.lastDay === null ? 'no data this month' : `data up to ${instance.lastDay}`
}
</script>

<template>
  <li :class="`status-${status}`">
    <span class="dot" aria-hidden="true"></span>
    <div class="body">
      <div class="title">
        <strong>{{ formatMonth(row.month) }}</strong>
        <span class="pill">
          <span v-if="status === 'sending'" class="spinner small" aria-hidden="true"></span>
          {{ statusText[status] }}
        </span>
      </div>

      <p v-if="status === 'sent' && deliveredAt" class="meta">Delivered {{ formatDateTime(deliveredAt) }}</p>

      <p v-else-if="row.kind === 'upcoming'" class="meta">
        <template v-if="row.upcoming.collectedUpTo">
          Collected up to {{ formatDay(row.upcoming.collectedUpTo) }}.
        </template>
        Can be submitted from {{ formatDay(row.upcoming.pendingFrom) }} (UTC).
      </p>

      <template v-else-if="row.kind === 'pending'">
        <p class="meta">
          {{ row.pending.complete }} of {{ row.pending.instances }}
          {{ row.pending.instances === 1 ? 'instance' : 'instances' }} reported the whole month
        </p>
        <ul v-if="row.pending.waiting.length + row.pending.stale.length > 0" class="missing">
          <li v-for="instance in row.pending.waiting" :key="instance.instanceId">
            <span class="mark mark-warning" aria-hidden="true"></span>
            <strong>{{ nameOf(instance) }}</strong> {{ lastDayText(instance) }}, next report due by
            {{ formatDateTime(instance.expectedBy) }}
          </li>
          <li v-for="instance in row.pending.stale" :key="instance.instanceId">
            <span class="mark mark-critical" aria-hidden="true"></span>
            <strong>{{ nameOf(instance) }}</strong> {{ lastDayText(instance) }}, silent for
            {{ daysSince(instance.lastReportAt) }} days
          </li>
        </ul>
      </template>
    </div>
  </li>
</template>

<style scoped>
li {
  position: relative;
  padding: 0 0 8px 30px;
  list-style: none;
}

/* The timeline: one line through every row's dot. */
li::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--track);
}

li:first-child::before {
  top: 20px;
}

li:last-child::before {
  bottom: calc(100% - 20px);
}

.dot {
  position: absolute;
  left: 2px;
  top: 14px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--page);
  background: var(--text-muted);
  box-shadow: 0 0 0 1px var(--track);
  transition: background 0.3s ease;
}

.body {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  transition:
    background 0.3s ease,
    border-color 0.3s ease;
}

.title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  background: var(--track);
  color: var(--text-secondary);
  transition:
    background 0.3s ease,
    color 0.3s ease;
}

.meta {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 0.88rem;
}

.missing {
  margin: 6px 0 0;
  padding: 0;
}

.missing li {
  padding: 2px 0;
  font-size: 0.86rem;
  color: var(--text-secondary);
}

.missing li::before {
  content: none;
}

.mark {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  vertical-align: 1px;
}

.mark-warning {
  background: var(--warning);
}

.mark-critical {
  background: var(--critical);
}

.status-upcoming .body {
  background: transparent;
  border-style: dashed;
  border-color: var(--border-strong);
}

.status-pending .dot {
  background: var(--warning);
}

.status-pending .pill {
  background: var(--warning-bg);
  color: var(--warning-text);
}

.status-sending .dot {
  background: var(--info);
}

.status-sending .pill {
  background: var(--info-bg);
  color: var(--info-text);
}

.status-sent .dot {
  background: var(--good);
}

.status-sent .pill {
  background: var(--good-bg);
  color: var(--good-text);
}

.status-failed .dot {
  background: var(--critical);
}

.status-failed .pill {
  background: var(--critical-bg);
  color: var(--critical-text);
}

.status-failed .body {
  border-color: var(--critical);
}

@media (prefers-reduced-motion: reduce) {
  .dot,
  .body,
  .pill {
    transition: none;
  }
}
</style>
