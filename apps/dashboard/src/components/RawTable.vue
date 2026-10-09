<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { anomalyNote, formatDay, formatDelta, formatNumber } from '@/utils/format'
import { type Anomaly, columnKey, type MetricColumn, type RawRow } from '@/utils/report'

const props = defineProps<{
  columns: MetricColumn[]
  rows: RawRow[]
  /** By `day|columnKey`, from anomaliesByCell. */
  anomalies: Map<string, Anomaly[]>
  selectedDay?: string
}>()

const time = (timestamp: string) => timestamp.slice(11, 16)

const cellAnomalies = (row: RawRow, column: MetricColumn) =>
  props.anomalies.get(`${row.day}|${columnKey(column)}`)

// Fixed to the viewport, so the table's own scroll box cannot clip it.
const tip = ref<{ text: string; left: number; top: number }>()

function showTip(event: MouseEvent, row: RawRow, column: MetricColumn): void {
  const anomalies = cellAnomalies(row, column)
  if (anomalies === undefined) {
    return
  }
  const cell = (event.currentTarget as HTMLElement).getBoundingClientRect()
  tip.value = { text: anomalies.map(anomalyNote).join('\n'), left: cell.right, top: cell.top }
}

function hideTip(): void {
  tip.value = undefined
}

onMounted(() => window.addEventListener('scroll', hideTip, { passive: true }))
onUnmounted(() => window.removeEventListener('scroll', hideTip))
</script>

<template>
  <div class="table-scroll" @scroll.passive="hideTip">
    <table>
      <thead>
        <tr>
          <th>Day</th>
          <th
            v-for="column in columns"
            :key="columnKey(column)"
            class="number"
            :title="column.name"
          >
            {{ column.kind === 'daily' ? 'Daily' : 'Total' }}
          </th>
          <th>Received (UTC)</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :id="`raw-${row.day}`"
          :key="row.day"
          :class="{ selected: row.day === selectedDay }"
        >
          <td class="nowrap">{{ formatDay(row.day) }}</td>
          <td
            v-for="column in columns"
            :key="columnKey(column)"
            :class="['number', 'nowrap', { 'anomaly-cell': cellAnomalies(row, column) }]"
            @mousemove="showTip($event, row, column)"
            @mouseleave="hideTip"
          >
            <template v-if="row.values.has(columnKey(column))">
              <div v-for="(entry, i) in row.values.get(columnKey(column))" :key="i">
                {{ formatNumber(entry.value) }}
                <span v-if="entry.delta !== undefined" class="muted"
                  >({{ formatDelta(entry.delta) }})</span
                >
              </div>
            </template>
            <span v-else class="muted">–</span>
          </td>
          <td class="nowrap muted">{{ row.received.map(time).join(', ') }}</td>
        </tr>
        <tr v-if="rows.length === 0">
          <td :colspan="columns.length + 2" class="muted">No data.</td>
        </tr>
      </tbody>
    </table>
    <div v-if="tip" class="tooltip" :style="{ left: `${tip.left}px`, top: `${tip.top}px` }">
      {{ tip.text }}
    </div>
  </div>
</template>
