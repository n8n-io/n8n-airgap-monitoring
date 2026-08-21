import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import InstancesTable from './InstancesTable.vue'

describe('InstancesTable', () => {
  it('shows an empty state when there are no instances', () => {
    const wrapper = mount(InstancesTable, { props: { instances: [], metricNames: [] } })

    expect(wrapper.text()).toContain('No instances have reported yet.')
  })

  it('renders an em-dash for a metric an instance has not reported', () => {
    const wrapper = mount(InstancesTable, {
      props: {
        instances: [
          { instanceId: 'a', label: null, n8nVersion: '1.0.0', receivedAt: 't', metrics: {} },
        ],
        metricNames: ['activeWorkflows'],
      },
    })

    expect(wrapper.find('.empty-cell').text()).toBe('—')
  })

  it('emits selectMetric with the instance id and metric name when a metric cell is clicked', async () => {
    const wrapper = mount(InstancesTable, {
      props: {
        instances: [
          {
            instanceId: 'instance-a',
            label: null,
            n8nVersion: '1.0.0',
            receivedAt: 't',
            metrics: { activeWorkflows: 5 },
          },
        ],
        metricNames: ['activeWorkflows'],
      },
    })

    await wrapper.find('button.metric-cell').trigger('click')

    expect(wrapper.emitted('selectMetric')).toEqual([['instance-a', 'activeWorkflows']])
  })
})
