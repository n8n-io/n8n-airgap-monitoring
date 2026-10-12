import { computed, ref, shallowRef } from 'vue'
import { isUsageReport, type UsageReport } from '@/utils/report'
import { summarize } from '@/utils/summary'

// Module state: the report is loaded once and shared by every view.
const report = shallowRef<UsageReport>()
const isLoading = ref(false)
const error = ref<string | null>(null)

const summaries = computed(() =>
  report.value === undefined
    ? []
    : summarize(report.value.data.instances, report.value.data.generatedAt),
)

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null

  try {
    // Served by the serve-report plugin in vite.config.ts.
    const response = await fetch('/report.json')
    if (!response.ok) {
      throw new Error(await response.text())
    }
    const body: unknown = await response.json()
    if (!isUsageReport(body)) {
      throw new Error('Not a report downloaded from GET /api/v1/report.')
    }
    report.value = body
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load the report'
  } finally {
    isLoading.value = false
  }
}

export function useReport() {
  return { report, summaries, isLoading, error, load }
}
