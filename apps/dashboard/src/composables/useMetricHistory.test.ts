import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from './useAuth'
import { useMetricHistory } from './useMetricHistory'

describe('useMetricHistory', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuth().logOut()
    vi.unstubAllGlobals()
  })

  it('clears isLoading once the request resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { kind: 'cumulative', points: [] } }),
      }),
    )

    const { isLoading, history, open } = useMetricHistory()
    await open('instance-1', 'activeWorkflows')

    expect(isLoading.value).toBe(false)
    expect(history.value).toEqual({ kind: 'cumulative', points: [] })
  })

  it('clears isLoading when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    const { isLoading, error, open } = useMetricHistory()
    await open('instance-1', 'activeWorkflows')

    expect(isLoading.value).toBe(false)
    expect(error.value).not.toBeNull()
  })
})
