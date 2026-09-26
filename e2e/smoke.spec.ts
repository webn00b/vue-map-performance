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
  ]) {
    await page.getByTestId(id).click()
    await page.waitForTimeout(1500)
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

test('falls back to WebGL instead of rendering too many DOM markers', async ({ page }) => {
  await page.goto('/?render=dom&n=20000')
  await expect(page.getByRole('status')).toContainText('capped at 10,000')
  await expect(page.getByTestId('render-webgl')).toHaveClass(/active/)
  await expect(page).not.toHaveURL(/render=dom/)
  await expect(page.locator('.courier-marker')).toHaveCount(0)
})
