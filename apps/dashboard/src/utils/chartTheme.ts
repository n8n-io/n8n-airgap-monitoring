import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import { ref } from 'vue'

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
)

/** Chart.js draws on a canvas, so it gets the CSS tokens as values and redraws when the scheme flips. */
function readTheme() {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string) => style.getPropertyValue(name).trim()

  return {
    series: token('--series-1'),
    series2: token('--series-2'),
    critical: token('--critical'),
    surface: token('--surface'),
    grid: token('--grid'),
    muted: token('--text-muted'),
    text: token('--text'),
    border: token('--border'),
  }
}

export const chartTheme = ref(readTheme())

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  chartTheme.value = readTheme()
})
