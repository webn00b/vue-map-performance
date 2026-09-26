// Runs every scenario in headless Chromium on the real GPU and prints a
// Markdown table. Usage: npm run bench [-- <filter>], e.g. `npm run bench -- Clusters`.
import { chromium } from '@playwright/test'
import { preview } from 'vite'

const PORT = 4180
const WARMUP_MS = 5000
const MEASURE_MS = 10_000

const allScenarios = [
  { label: 'GPU layer, shallowRef', query: 'n=10000&render=gpu&state=shallow' },
  { label: 'GPU layer, deep ref', query: 'n=10000&render=gpu&state=deep' },
  { label: 'GeoJSON, shallowRef', query: 'n=10000&render=webgl&state=shallow' },
  { label: 'GeoJSON, deep ref', query: 'n=10000&render=webgl&state=deep' },
  { label: 'Clusters, shallowRef', query: 'n=10000&render=cluster&state=shallow' },
  { label: 'DOM markers, shallowRef', query: 'n=10000&render=dom&state=shallow' },
  { label: 'DOM markers, deep ref', query: 'n=10000&render=dom&state=deep' },
  { label: '50k, GPU layer, shallowRef', query: 'n=50000&render=gpu&state=shallow' },
  { label: '50k, GeoJSON, shallowRef', query: 'n=50000&render=webgl&state=shallow' },
  { label: '50k, GeoJSON, deep ref', query: 'n=50000&render=webgl&state=deep' },
  { label: '200k, GPU layer, shallowRef', query: 'n=200000&render=gpu&state=shallow' },
]

const filter = process.argv[2]
const scenarios = filter
  ? allScenarios.filter((scenario) => scenario.label.includes(filter))
  : allScenarios

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' })

try {
  const browser = await chromium.launch({
    // Without these, headless Chromium falls back to software WebGL.
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })

  const rows = []
  for (const scenario of scenarios) {
    await page.goto(`http://localhost:${PORT}/?${scenario.query}`)
    await page.locator('[data-testid=courier-list] button').first().waitFor()
    await page.waitForTimeout(WARMUP_MS)
    await dragMapFor(page, MEASURE_MS)
    rows.push({ label: scenario.label, ...(await readMetrics(page)) })
    console.error(`done: ${scenario.label}`)
  }
  await browser.close()

  console.log(`GPU: ${gpu}\n`)
  console.log(
    '| Scenario | FPS (lowest) | Map updates / feed, per s | Long tasks, ms / 5 s | Update avg / max, ms |',
  )
  console.log('| --- | --- | --- | --- | --- |')
  for (const row of rows) {
    console.log(
      `| ${row.label} | ${row.fps} (${row.fpsLow}) | ${row.mapUpdates} / ${row.feedMessages} | ${row.longTaskMs} | ${row.flushMs} / ${row.flushMaxMs} |`,
    )
  }
} finally {
  await server.close()
}

/** Pans the map back and forth, like a user looking around. */
async function dragMapFor(page, ms) {
  const x = 720
  const y = 450
  const end = Date.now() + ms
  let direction = 1
  while (Date.now() < end) {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 200 * direction, y + 80 * direction, { steps: 30 })
    await page.mouse.up()
    direction *= -1
  }
}

async function readMetrics(page) {
  return page.locator('[data-testid=metrics]').evaluate((element) => {
    const read = (name, digits = 0) => Number(element.dataset[name]).toFixed(digits)
    return {
      fps: read('fps'),
      fpsLow: read('fpsLow'),
      longTaskMs: read('longTaskMs'),
      flushMs: read('flushMs', 1),
      flushMaxMs: read('flushMaxMs', 1),
      mapUpdates: read('mapUpdates'),
      feedMessages: read('feedMessages'),
    }
  })
}
