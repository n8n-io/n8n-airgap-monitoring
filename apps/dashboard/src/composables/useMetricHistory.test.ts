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

  it('clears isLoading when closed while a request is in flight', async () => {
    let resolveFetch: (value: unknown) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
      ),
    )

    const { isLoading, open, close } = useMetricHistory()
    const pending = open('instance-1', 'activeWorkflows')
    expect(isLoading.value).toBe(true)

    close()
    resolveFetch({ ok: true, json: async () => ({ data: { kind: 'cumulative', points: [] } }) })
    await pending

    expect(isLoading.value).toBe(false)
  })
})
