import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSecret, setSecret } from './auth-state'
import { ApiError, checkAuth, fetchInstanceReports } from './client'

describe('checkAuth', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves without reading a response body', async () => {
    const json = vi.fn<() => Promise<unknown>>()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json }))

    await expect(checkAuth('a-secret')).resolves.toBeUndefined()
    expect(json).not.toHaveBeenCalled()
  })

  it('sends the secret as a bearer token against /api/v1/auth/check', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    await checkAuth('a-secret')

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/auth/check',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer a-secret' }),
      }),
    )
  })

  it('throws ApiError with the response status on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    await expect(checkAuth('wrong-secret')).rejects.toEqual(new ApiError(401))
  })
})

describe('fetchInstanceReports', () => {
  beforeEach(() => {
    clearSecret()
  })

  afterEach(() => {
    clearSecret()
    vi.unstubAllGlobals()
  })

  it('sends the stored secret as a bearer token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { instances: [] } }) }),
    )
    setSecret('stored-secret')

    await fetchInstanceReports()

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/instance-reports',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer stored-secret' }),
      }),
    )
  })
})
