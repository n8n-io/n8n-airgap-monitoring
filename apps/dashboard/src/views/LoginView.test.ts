import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'
import LoginView from './LoginView.vue'

async function mountLoginView() {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/', name: 'dashboard', component: { template: '<div>dashboard</div>' } },
    ],
  })
  router.push('/login')
  await router.isReady()

  return mount(LoginView, { global: { plugins: [router] } })
}

describe('LoginView', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuth().logOut()
    vi.unstubAllGlobals()
  })

  it('logs in and navigates to the dashboard on a correct secret', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    const wrapper = await mountLoginView()
    await wrapper.find('input#secret').setValue('correct-secret')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(useAuth().isAuthenticated.value).toBe(true)
    expect(wrapper.text()).not.toContain('Incorrect secret')
  })

  it('shows an error on an incorrect secret', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))

    const wrapper = await mountLoginView()
    await wrapper.find('input#secret').setValue('wrong-secret')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Incorrect secret')
    expect(useAuth().isAuthenticated.value).toBe(false)
  })
})
