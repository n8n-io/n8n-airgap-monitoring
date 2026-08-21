import { computed, ref } from 'vue'
import { ApiError, fetchInstanceReports } from '@/api-client/client'
import type { InstanceSummary } from '@/api-client/types'
import { useAuth } from './useAuth'

export function useInstanceReports() {
  const { logOut } = useAuth()

  const instances = ref<InstanceSummary[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Metric columns span the whole list rather than one page, so this is a
  // plain union over every instance's reported metric names.
  const metricNames = computed(() =>
    [...new Set(instances.value.flatMap((instance) => Object.keys(instance.metrics)))].sort(),
  )

  async function load(): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      const result = await fetchInstanceReports()
      instances.value = result.instances
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logOut()
        return
      }

      error.value = err instanceof Error ? err.message : 'Failed to load instance reports'
    } finally {
      isLoading.value = false
    }
  }

  return { instances, metricNames, isLoading, error, load }
}
