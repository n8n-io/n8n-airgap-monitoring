import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import InstancesTable from './InstancesTable.vue'

const noHistoryProps = {
  activeTarget: null,
  history: null,
  isHistoryLoading: false,
  historyError: null,
}

describe('InstancesTable', () => {
  it('shows an empty state when there are no instances', () => {
    const wrapper = mount(InstancesTable, {
      props: { instances: [], metricNames: [], ...noHistoryProps },
    })

    expect(wrapper.text()).toContain('No instances have reported yet.')
  })

  it('renders an em-dash for a metric an instance has not reported', () => {
    const wrapper = mount(InstancesTable, {
      props: {
        instances: [
          { instanceId: 'a', label: null, n8nVersion: '1.0.0', receivedAt: 't', metrics: {} },
        ],
        metricNames: ['activeWorkflows'],
        ...noHistoryProps,
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
        ...noHistoryProps,
      },
    })

    await wrapper.find('button.metric-cell').trigger('click')

    expect(wrapper.emitted('selectMetric')).toEqual([['instance-a', 'activeWorkflows']])
  })

  it('renders the history panel in a row directly below the instance whose metric is active', () => {
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
          {
            instanceId: 'instance-b',
            label: null,
            n8nVersion: '1.0.0',
            receivedAt: 't',
            metrics: { activeWorkflows: 7 },
          },
        ],
        metricNames: ['activeWorkflows'],
        activeTarget: { instanceId: 'instance-a', metricName: 'activeWorkflows' },
        history: { kind: 'cumulative', points: [{ receivedAt: 't', value: 5 }] },
        isHistoryLoading: false,
        historyError: null,
      },
    })

    const rows = wrapper.findAll('table.instances-table > tbody > tr')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.text()).toContain('instance-a')
    expect(rows[1]?.find('td').attributes('colspan')).toBe('4')
    expect(rows[2]?.text()).toContain('instance-b')
  })

  it('emits closeHistory when the history panel is closed', async () => {
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
        activeTarget: { instanceId: 'instance-a', metricName: 'activeWorkflows' },
        history: null,
        isHistoryLoading: false,
        historyError: null,
      },
    })

    await wrapper.find('.history-row button').trigger('click')

    expect(wrapper.emitted('closeHistory')).toHaveLength(1)
  })
})
