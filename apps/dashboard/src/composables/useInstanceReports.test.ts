import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from './useAuth'
import { useInstanceReports } from './useInstanceReports'

describe('useInstanceReports', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuth().logOut()
    vi.unstubAllGlobals()
  })

  it('computes the sorted union of metric names across instances', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            instances: [
              {
                instanceId: 'a',
                label: null,
                n8nVersion: '1.0.0',
                receivedAt: 't',
                metrics: { z: 1, a: 2 },
              },
              {
                instanceId: 'b',
                label: null,
                n8nVersion: '1.0.0',
                receivedAt: 't',
                metrics: { m: 3 },
              },
            ],
          },
        }),
      }),
    )

    const { metricNames, load } = useInstanceReports()
    await load()

    expect(metricNames.value).toEqual(['a', 'm', 'z'])
  })

  it('leaves a metric absent from a given instance out of that instance, not the union', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            instances: [
              {
                instanceId: 'a',
                label: null,
                n8nVersion: '1.0.0',
                receivedAt: 't',
                metrics: { x: 1 },
              },
              { instanceId: 'b', label: null, n8nVersion: '1.0.0', receivedAt: 't', metrics: {} },
            ],
          },
        }),
      }),
    )

    const { instances, load } = useInstanceReports()
    await load()

    expect(instances.value[1]?.metrics.x).toBeUndefined()
  })

  it('logs out on a 401 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const { logIn, isAuthenticated } = useAuth()
    await logIn('secret')
    expect(isAuthenticated.value).toBe(true)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    const { load } = useInstanceReports()
    await load()

    expect(isAuthenticated.value).toBe(false)
  })
})
