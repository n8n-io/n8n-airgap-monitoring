<script setup lang="ts">
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui'
import { computed } from 'vue'
import { anomalyNote, formatDay, formatDelta, formatNumber } from '@/utils/format'
import { type Anomaly, columnKey, type Metric, type RawRow } from '@/utils/report'

const props = defineProps<{
  metrics: Metric[]
  rows: RawRow[]
  /** By `day|columnKey`, from anomaliesByCell. */
  anomalies: Map<string, Anomaly[]>
  selectedDay?: string
}>()

const columns = computed(() =>
  props.metrics.flatMap(({ name, kinds }) =>
    kinds.map((kind) => ({ name, kind, key: columnKey(name, kind) })),
  ),
)

const time = (timestamp: string) => timestamp.slice(11, 16)

const cellAnomalies = (row: RawRow, column: { key: string }) =>
  props.anomalies.get(`${row.day}|${column.key}`)
</script>

<template>
  <TooltipProvider :delay-duration="0">
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th rowspan="2">Day</th>
            <th v-for="metric in metrics" :key="metric.name" :colspan="metric.kinds.length">
              {{ metric.name }}
            </th>
            <th rowspan="2">Received (UTC)</th>
          </tr>
          <tr>
            <th v-for="column in columns" :key="column.key" class="number">
              {{ column.kind === 'daily' ? 'Daily' : 'Total' }}
            </th>
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
            <TooltipRoot
              v-for="column in columns"
              :key="column.key"
              :disabled="!cellAnomalies(row, column)"
            >
              <TooltipTrigger as-child>
                <td
                  :class="['number', 'nowrap', { 'anomaly-cell': cellAnomalies(row, column) }]"
                  :tabindex="cellAnomalies(row, column) ? 0 : undefined"
                >
                  <template v-if="row.values.has(column.key)">
                    <div v-for="(entry, i) in row.values.get(column.key)" :key="i">
                      {{ formatNumber(entry.value) }}
                      <span v-if="entry.delta !== undefined" class="muted"
                        >({{ formatDelta(entry.delta) }})</span
                      >
                    </div>
                  </template>
                  <span v-else class="muted">–</span>
                </td>
              </TooltipTrigger>
              <TooltipPortal>
                <TooltipContent class="tooltip" side="top" align="end" :side-offset="6">
                  <div v-for="(anomaly, i) in cellAnomalies(row, column)" :key="i">
                    {{ anomalyNote(anomaly) }}
                  </div>
                </TooltipContent>
              </TooltipPortal>
            </TooltipRoot>
            <td class="nowrap muted">{{ row.received.map(time).join(', ') }}</td>
          </tr>
          <tr v-if="rows.length === 0">
            <td :colspan="columns.length + 2" class="muted">No data.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </TooltipProvider>
</template>
