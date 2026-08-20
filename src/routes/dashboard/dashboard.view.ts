import type { InstanceListItem, MetricValue } from '../../dashboard/dashboard.service'
import { DASHBOARD_STYLES } from './dashboard.assets'

/**
 * Route path, relative to where this plugin is mounted, of the compiled
 * ./dashboard.client.ts. Kept next to the tag that loads it; ./index.ts serves
 * the same path.
 */
export const CLIENT_SCRIPT_PATH = '/dashboard.client.js'

/**
 * The mount point is hardcoded because the client script already builds its own
 * absolute URLs (`/dashboard/rows`), so there is one place to change either way.
 */
const CLIENT_SCRIPT_URL = `/dashboard${CLIENT_SCRIPT_PATH}`

/** Columns present for every instance, ahead of the page's metric columns. */
const FIXED_COLUMNS = ['Instance ID', 'Label', 'n8n Version', 'Last Received'] as const

/** Em dash, for a value the instance has never reported. */
const EMPTY_VALUE = '—'

/** Everything the page needs to render. `nextCursor: null` means "last page". */
export interface DashboardPageModel {
  instances: InstanceListItem[]
  metricNames: string[]
  nextCursor: number | null
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

/**
 * Escapes text for both element content and double/single-quoted attribute
 * values. Every interpolation below goes through this: instance ids, labels and
 * metric names are operator-supplied strings straight from an ingested payload,
 * so they are untrusted input.
 */
export function escapeHtml (value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])
}

function formatMetricValue (metric: MetricValue): string {
  return metric.kind === 'daily'
    ? `${metric.value} (${metric.date})`
    : String(metric.value)
}

/**
 * Metric headers carry their own name, so the "load more" script can tell the
 * server which columns are already on screen and widen the table if a later
 * page brings a metric this page never reported.
 */
export function renderTableHeader (metricNames: string[]): string {
  const fixed = FIXED_COLUMNS.map((name) => `<th>${name}</th>`).join('')
  const metrics = metricNames
    .map((name) => `<th data-metric="${escapeHtml(name)}">${escapeHtml(name)}</th>`)
    .join('')

  return `<thead><tr>${fixed}${metrics}</tr></thead>`
}

function renderTextCell (text: string): string {
  return `<td>${escapeHtml(text)}</td>`
}

/**
 * A metric cell carries its own coordinates as data attributes; the inline
 * script reads them on click to fetch that metric's history.
 */
function renderMetricCell (instanceId: string, metricName: string, metric: MetricValue | undefined): string {
  if (metric === undefined) {
    return `<td class="empty-cell">${EMPTY_VALUE}</td>`
  }

  return '<td class="metric-cell" title="View history"' +
    ` data-instance-id="${escapeHtml(instanceId)}"` +
    ` data-metric="${escapeHtml(metricName)}">${escapeHtml(formatMetricValue(metric))}</td>`
}

export function renderInstanceRow (instance: InstanceListItem, metricNames: string[]): string {
  const fixedCells = [
    instance.instanceId,
    instance.label ?? EMPTY_VALUE,
    instance.n8nVersion,
    instance.lastReceivedAt
  ].map(renderTextCell).join('')

  const metricCells = metricNames
    .map((name) => renderMetricCell(instance.instanceId, name, instance.metrics[name]))
    .join('')

  return `<tr>${fixedCells}${metricCells}</tr>`
}

/** The `<tr>` run appended to the table when "Load more" is clicked. */
export function renderInstanceRows (instances: InstanceListItem[], metricNames: string[]): string {
  return instances.map((instance) => renderInstanceRow(instance, metricNames)).join('')
}

function renderEmptyState (columnCount: number): string {
  return `<tr><td class="empty-state" colspan="${columnCount}">No instances have reported usage yet.</td></tr>`
}

export function renderInstancesTable (instances: InstanceListItem[], metricNames: string[]): string {
  const rows = instances.length === 0
    ? renderEmptyState(FIXED_COLUMNS.length + metricNames.length)
    : renderInstanceRows(instances, metricNames)

  return `<table id="instances-table">${renderTableHeader(metricNames)}<tbody>${rows}</tbody></table>`
}

/**
 * Omitted entirely on the last page: its absence is what tells the script there
 * is nothing left to fetch.
 */
export function renderLoadMore (nextCursor: number | null): string {
  return nextCursor === null
    ? ''
    : `<button id="load-more" type="button" data-cursor="${nextCursor}">Load more</button>`
}

/** Empty shell; the client script fills it in on demand. */
function renderHistoryPanel (): string {
  return `<div id="history-panel" hidden>
    <h2 id="history-title"></h2>
    <table id="history-table">
      <thead></thead>
      <tbody></tbody>
    </table>
    <button id="close-history" type="button">Close</button>
  </div>`
}

export function renderDashboardPage (model: DashboardPageModel): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Airgap Monitoring Dashboard</title>
<style>${DASHBOARD_STYLES}</style>
</head>
<body>
  <h1>Airgap Monitoring Dashboard</h1>
  ${renderInstancesTable(model.instances, model.metricNames)}
  ${renderLoadMore(model.nextCursor)}
  ${renderHistoryPanel()}
  <script type="module" src="${CLIENT_SCRIPT_URL}"></script>
</body>
</html>
`
}
