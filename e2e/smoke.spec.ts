import { expect, test, type Page } from '@playwright/test'

function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function waitForCouriers(page: Page) {
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
  // The list fills in once the first snapshot has been applied.
  await expect(page.getByTestId('courier-list').getByRole('button').first()).toBeVisible()
}

/** Waits until the metrics have reported a processed update, i.e. the new mode is running. */
async function waitForUpdates(page: Page) {
  await expect(page.getByTestId('metrics')).not.toHaveAttribute('data-flush-ms', '0', {
    timeout: 10_000,
  })
}

test('switches through every mode without errors', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/')
  await waitForCouriers(page)

  for (const id of [
    'state-deep',
    'render-cluster',
    'feed-snapshot',
    'render-dom',
    'state-shallow',
    'feed-stream',
    'render-webgl',
    'render-gpu',
  ]) {
    await page.getByTestId(id).click()
    await expect(page.getByTestId(id)).toHaveClass(/active/)
    await waitForUpdates(page)
  }

  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('settings survive a reload through the URL', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('render-cluster').click()
  await page.getByTestId('state-deep').click()
  await expect(page).toHaveURL(/render=cluster/)
  await expect(page).toHaveURL(/state=deep/)

  await page.reload()
  await expect(page.getByTestId('render-cluster')).toHaveClass(/active/)
  await expect(page.getByTestId('state-deep')).toHaveClass(/active/)
})

test('falls back to the GPU layer instead of rendering too many DOM markers', async ({ page }) => {
  await page.goto('/?render=dom&n=20000')
  await expect(page.getByRole('status')).toContainText('capped at 10,000')
  await expect(page.getByTestId('render-gpu')).toHaveClass(/active/)
  await expect(page).not.toHaveURL(/render=dom/)
  await expect(page.locator('.courier-marker')).toHaveCount(0)
})
