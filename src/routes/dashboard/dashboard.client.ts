/**
 * Browser-side code for the dashboard page. Everything else in this directory
 * runs on the server; this file is the exception, so it is compiled separately
 * by tsconfig.client.json (DOM lib, no Node types, plain-script output) into
 * dist/public/dashboard.client.js and served by ./index.ts.
 *
 * Two things happen here, both on demand so the first response stays small:
 * loading the next page of instances, and drilling into one metric's history.
 *
 * Deliberately self-contained: `module: none` means no imports, which is what
 * keeps the emit a bare script the browser can run as-is. The interfaces below
 * therefore restate the JSON shapes rather than importing them.
 */

interface RowsFragment {
  /** Server-rendered `<tr>` markup, already escaped by dashboard.view.ts. */
  rowsHtml: string
  newColumns: string[]
  nextCursor: number | null
}

interface DailyPoint {
  date: string
  value: number
  batchId: string
}

interface CumulativePoint {
  receivedAt: string
  value: number
}

type MetricHistory =
  | { kind: 'daily', points: DailyPoint[] }
  | { kind: 'cumulative', points: CumulativePoint[] }

const EM_DASH = '—'
const ELLIPSIS = '…'
const JSON_HEADERS = { accept: 'application/json' }

/** Throws rather than returning null: a missing element is a template bug. */
function required<T extends Element> (selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector)
  if (element === null) {
    throw new Error(`dashboard template is missing ${selector}`)
  }

  return element
}

async function fetchJson<T> (url: string): Promise<T> {
  const response = await fetch(url, { headers: JSON_HEADERS })
  if (!response.ok) {
    throw new Error(`request failed with status ${response.status}`)
  }

  return await response.json() as T
}

function cell (tag: 'td' | 'th', text: string): HTMLTableCellElement {
  const element = document.createElement(tag)
  element.textContent = text

  return element
}

function row (tag: 'td' | 'th', values: string[]): HTMLTableRowElement {
  const tableRow = document.createElement('tr')
  for (const value of values) {
    tableRow.appendChild(cell(tag, value))
  }

  return tableRow
}

function clearChildren (node: Node): void {
  while (node.firstChild !== null) {
    node.removeChild(node.firstChild)
  }
}

const instancesTable = required<HTMLTableElement>('#instances-table')
const instancesHead = required<HTMLTableRowElement>('thead tr', instancesTable)
const instancesBody = required<HTMLTableSectionElement>('tbody', instancesTable)

// Absent once the last page is on screen; its presence is what says there is
// more to fetch.
const loadMore = document.querySelector<HTMLButtonElement>('#load-more')

function currentColumns (): string[] {
  return [...instancesHead.querySelectorAll('th[data-metric]')]
    .map((header) => header.getAttribute('data-metric') ?? '')
}

/**
 * Metric columns are page-scoped, so a later page can introduce a metric the
 * table has no column for yet. The server renders appended rows with the
 * columns already on screen first and any new ones after, so widening the
 * header and the rows already rendered is enough to keep them lined up.
 */
function addColumns (names: string[]): void {
  for (const name of names) {
    const header = cell('th', name)
    header.setAttribute('data-metric', name)
    instancesHead.appendChild(header)

    for (const existingRow of instancesBody.rows) {
      const padding = cell('td', EM_DASH)
      padding.className = 'empty-cell'
      existingRow.appendChild(padding)
    }
  }
}

async function appendNextPage (button: HTMLButtonElement): Promise<void> {
  const cursor = button.getAttribute('data-cursor') ?? ''
  const query = new URLSearchParams({ cursor, columns: currentColumns().join(',') })

  button.disabled = true
  button.textContent = `Loading${ELLIPSIS}`

  try {
    const fragment = await fetchJson<RowsFragment>(`/dashboard/rows?${query.toString()}`)

    addColumns(fragment.newColumns)
    instancesBody.insertAdjacentHTML('beforeend', fragment.rowsHtml)

    if (fragment.nextCursor === null) {
      button.remove()
      return
    }

    button.setAttribute('data-cursor', String(fragment.nextCursor))
    button.disabled = false
    button.textContent = 'Load more'
  } catch (error) {
    button.disabled = false
    button.textContent = `Load more (${(error as Error).message})`
  }
}

const historyPanel = required<HTMLDivElement>('#history-panel')
const historyTitle = required<HTMLHeadingElement>('#history-title')
const historyTable = required<HTMLTableElement>('#history-table')
const historyHead = required<HTMLTableSectionElement>('thead', historyTable)
const historyBody = required<HTMLTableSectionElement>('tbody', historyTable)

function renderHistory (instanceId: string, metricName: string, history: MetricHistory): void {
  historyTitle.textContent = `${instanceId} ${EM_DASH} ${metricName} (${history.kind})`
  clearChildren(historyHead)
  clearChildren(historyBody)

  const isDaily = history.kind === 'daily'
  historyHead.appendChild(row('th', isDaily ? ['Date', 'Value', 'Batch ID'] : ['Received At', 'Value']))

  for (const point of history.points) {
    historyBody.appendChild(row('td', 'date' in point
      ? [point.date, String(point.value), point.batchId]
      : [point.receivedAt, String(point.value)]))
  }

  if (history.points.length === 0) {
    const empty = cell('td', 'No data points reported yet.')
    empty.colSpan = isDaily ? 3 : 2
    empty.className = 'empty-state'

    const emptyRow = document.createElement('tr')
    emptyRow.appendChild(empty)
    historyBody.appendChild(emptyRow)
  }
}

async function showHistory (instanceId: string, metricName: string): Promise<void> {
  const url = `/api/v1/instances/${encodeURIComponent(instanceId)}` +
    `/metrics/${encodeURIComponent(metricName)}/history`

  clearChildren(historyHead)
  clearChildren(historyBody)
  historyTitle.textContent = `Loading${ELLIPSIS}`
  historyPanel.hidden = false

  try {
    renderHistory(instanceId, metricName, await fetchJson<MetricHistory>(url))
  } catch (error) {
    historyTitle.textContent = `Could not load history: ${(error as Error).message}`
  }
}

loadMore?.addEventListener('click', () => { void appendNextPage(loadMore) })

// Delegated so server-rendered rows need no per-cell inline handlers, which
// would mean escaping ids into a JS context on top of the HTML one. It also
// covers rows appended later for free.
instancesTable.addEventListener('click', (event) => {
  const target = (event.target as Element).closest('td[data-metric]')
  if (target === null) {
    return
  }

  void showHistory(
    target.getAttribute('data-instance-id') ?? '',
    target.getAttribute('data-metric') ?? ''
  )
})

required<HTMLButtonElement>('#close-history').addEventListener('click', () => {
  historyPanel.hidden = true
})
