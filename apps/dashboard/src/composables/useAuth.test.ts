import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from './useAuth'

describe('useAuth', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuth().logOut()
    vi.unstubAllGlobals()
  })

  it('accepts a secret that the API confirms with 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    const { isAuthenticated, logIn } = useAuth()
    const success = await logIn('correct-secret')

    expect(success).toBe(true)
    expect(isAuthenticated.value).toBe(true)
    expect(sessionStorage.getItem('dashboard.secret')).toBe('correct-secret')
  })

  it('rejects a secret that the API answers with 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    const { isAuthenticated, logIn } = useAuth()
    const success = await logIn('wrong-secret')

    expect(success).toBe(false)
    expect(isAuthenticated.value).toBe(false)
  })

  it('logOut clears the secret and sessionStorage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    const { isAuthenticated, logIn, logOut } = useAuth()
    await logIn('correct-secret')

    logOut()

    expect(isAuthenticated.value).toBe(false)
    expect(sessionStorage.getItem('dashboard.secret')).toBeNull()
  })
})
