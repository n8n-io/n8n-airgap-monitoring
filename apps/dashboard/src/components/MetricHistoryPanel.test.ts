import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MetricHistoryPanel from './MetricHistoryPanel.vue'

const target = { instanceId: 'instance-a', metricName: 'activeWorkflows' }

describe('MetricHistoryPanel', () => {
  it('renders daily points with a batch id column', () => {
    const wrapper = mount(MetricHistoryPanel, {
      props: {
        target,
        isLoading: false,
        error: null,
        history: {
          kind: 'daily',
          points: [{ date: '2026-03-25', value: 42, batchId: 'b1' }],
        },
      },
    })

    expect(wrapper.text()).toContain('Batch ID')
    expect(wrapper.text()).toContain('b1')
  })

  it('renders cumulative points without a batch id column', () => {
    const wrapper = mount(MetricHistoryPanel, {
      props: {
        target,
        isLoading: false,
        error: null,
        history: {
          kind: 'cumulative',
          points: [{ receivedAt: '2026-03-25T00:00:00.000Z', value: 87 }],
        },
      },
    })

    expect(wrapper.text()).not.toContain('Batch ID')
    expect(wrapper.text()).toContain('87')
  })

  it('shows an empty state when there are no points', () => {
    const wrapper = mount(MetricHistoryPanel, {
      props: { target, isLoading: false, error: null, history: { kind: 'cumulative', points: [] } },
    })

    expect(wrapper.text()).toContain('No data points reported yet.')
  })

  it('emits close when the close button is clicked', async () => {
    const wrapper = mount(MetricHistoryPanel, {
      props: { target, isLoading: false, error: null, history: null },
    })

    await wrapper.find('button').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('renders nothing visible when there is no target', () => {
    const wrapper = mount(MetricHistoryPanel, {
      props: { target: null, isLoading: false, error: null, history: null },
    })

    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })
})
