import { markRaw, ref } from 'vue'
import { ApiError, fetchMetricHistory } from '@/api-client/client'
import type { MetricHistory } from '@/api-client/types'
import { useAuth } from './useAuth'

export interface MetricHistoryTarget {
  instanceId: string
  metricName: string
}

export function useMetricHistory() {
  const { logOut } = useAuth()

  const target = ref<MetricHistoryTarget | null>(null)
  const history = ref<MetricHistory | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  async function open(instanceId: string, metricName: string): Promise<void> {
    const requested: MetricHistoryTarget = markRaw({ instanceId, metricName })

    target.value = requested
    history.value = null
    isLoading.value = true
    error.value = null

    try {
      const result = await fetchMetricHistory(instanceId, metricName)

      // A second click while this request is in flight moves `target` on;
      // discard this response instead of overwriting the newer one.
      if (target.value !== requested) {
        return
      }

      history.value = result
    } catch (err) {
      if (target.value !== requested) {
        return
      }

      if (err instanceof ApiError && err.status === 401) {
        logOut()
        return
      }

      error.value = err instanceof Error ? err.message : 'Failed to load metric history'
    } finally {
      if (target.value === requested) {
        isLoading.value = false
      }
    }
  }

  function close(): void {
    target.value = null
    history.value = null
    error.value = null
  }

  return { target, history, isLoading, error, open, close }
}
