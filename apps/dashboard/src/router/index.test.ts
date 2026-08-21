import { beforeEach, describe, expect, it } from 'vitest'
import { useAuth } from '@/composables/useAuth'
import router from './index'

describe('router guard', () => {
  beforeEach(async () => {
    sessionStorage.clear()
    useAuth().logOut()
    await router.replace('/')
  })

  it('redirects an unauthenticated visit to / onto /login with a redirect query', async () => {
    await router.push('/')

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/')
  })

  it('redirects an authenticated visit to /login back to the dashboard', async () => {
    useAuth().secret.value = 'a-secret'

    await router.push('/login')

    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('allows an authenticated visit to /', async () => {
    useAuth().secret.value = 'a-secret'

    await router.push('/')

    expect(router.currentRoute.value.name).toBe('dashboard')
  })
})
