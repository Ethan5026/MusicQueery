// M9: the Solo view on Let It Be with the companion's transcribed melody (fixture made from the truth audio by
// `mqc.pipeline.add_melody`), portrait and sideways, and the empty state on the demo chart, which has no melody.
import { readFileSync } from 'node:fs'
import { type Page, expect, test } from '@playwright/test'

const LET_IT_BE = readFileSync(new URL('./fixtures/let-it-be-melody.timeline.json', import.meta.url), 'utf8')

test.beforeEach(async ({ page }) => {
  await page.route('**/api/timelines/spotify:track:7iN1s7xHE4ifF5povM6A48', (r) =>
    r.fulfill({ body: LET_IT_BE, contentType: 'application/json' }),
  )
  await page.route('**/api/log', (r) => r.fulfill({ status: 204 }))
})

const tab = (page: Page, name: string) => page.locator('nav.tabs').getByRole('button', { name })

async function seek(page: Page, ms: number) {
  await page.getByLabel('Song position').evaluate((el, v) => {
    const input = el as HTMLInputElement
    input.value = String(v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, ms)
}

async function openLetItBe(page: Page) {
  await page.goto('/')
  await tab(page, 'Tracks').click()
  await page.getByRole('listitem').filter({ hasText: 'Let It Be' }).click()
  await expect(page.locator('.np-title')).toHaveText('Let It Be')
}

test('portrait: Solo shows the melody under the chords with the scale below, in written pitch', async ({ page }) => {
  await openLetItBe(page)
  // "Mother Mary comes to me": the first verse
  await seek(page, 17500)
  await page.locator('label[for="pstand-solo"]').click()
  const staff = page.getByTestId('solo-staff')
  await expect(staff).toBeVisible()
  await expect(staff.locator('.nh.sl').first()).toBeVisible()
  expect(await staff.locator('.nh.sl').count()).toBeGreaterThan(10)
  await expect(staff.locator('.sl-ch').first()).toBeVisible()
  await expect(page.locator('.sl-scale .scale-h b').first()).toHaveText('C major')
  await expect(page.locator('.sl-scale .nh.t').first()).toBeVisible()
  const [scroll, client] = await page.locator('main.view').evaluate((el) => [el.scrollHeight, el.clientHeight])
  expect(scroll, `content ${scroll} px in ${client} px`).toBeLessThanOrEqual(client)
  if (process.env.E2E_SHOTS) await page.screenshot({ path: 'test-results/shot-solo.png' })
  // concert C major is written A major for alto: the names move with it
  const concert = await staff.locator('.st-nm.sl').allTextContents()
  await page.locator('label[for="sinst-alto"]').click()
  await expect(page.locator('.sl-scale .scale-h b').first()).toHaveText('A major')
  const alto = await staff.locator('.st-nm.sl').allTextContents()
  expect(alto).not.toEqual(concert)
  expect(alto.some((n) => n.includes('♯'))).toBe(true)
  // the choice is kept: Chart comes back on the same switch
  await page.locator('label[for="pstand-chart"]').click()
  await expect(page.getByTestId('hero-chord')).toBeVisible()
})

test('sideways: the Solo sheet fills the screen; Chart brings the lead sheet back', async ({ page }) => {
  await openLetItBe(page)
  await seek(page, 17500)
  await page.locator('label[for="pstand-solo"]').click()
  await page.setViewportSize({ width: 874, height: 402 })
  await expect(page.getByTestId('solo-sheet')).toBeVisible()
  await expect(page.getByTestId('solo-staff').locator('.nh.sl').first()).toBeVisible()
  if (process.env.E2E_SHOTS) await page.screenshot({ path: 'test-results/shot-solo-land.png' })
  await page.locator('label[for="lstand-chart"]').click()
  await expect(page.getByTestId('lead-sheet')).toBeVisible()
  await page.setViewportSize({ width: 402, height: 778 })
})

test('no melody: the demo chart says where one comes from', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.np-title')).toHaveText('All the Things You Are')
  await page.locator('label[for="pstand-solo"]').click()
  await expect(page.getByTestId('no-melody')).toContainText('built-in tunes and drills have none')
})
