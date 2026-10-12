// M8: the Song map and Scale coach tabs on the demo chart (manual clock), at iPhone 17 size.
import { type Page, expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/log', (r) => r.fulfill({ status: 204 }))
})

const tab = (page: Page, name: string) => page.locator('nav.tabs').getByRole('button', { name })
const hero = (page: Page) => page.getByTestId('hero-chord')

test('Song map: a row per pass coloured by key, key areas, tap to jump, loop the section under the playhead', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.np-title')).toHaveText('All the Things You Are')
  await tab(page, 'Map').click()
  const rows = page.getByTestId('map-rows').locator('.mrow')
  await expect(rows.first().locator('.nm')).toContainText('Intro')
  await expect(rows.nth(1).locator('.nm')).toContainText('Chorus 1')
  await expect(rows.nth(1).locator('.strip i')).toHaveCount(36)
  await expect(page.locator('.sec-ticks')).toContainText('A1A2BA3')
  await expect(page.getByLabel('Key areas')).toContainText('in one chorus')
  await expect(page.getByLabel('Key areas').locator('.krow').first()).toContainText('home')
  await expect(page.getByTestId('map-playhead')).toHaveCount(1)
  // jump to chorus 2, then loop the A1 section there
  await rows.nth(2).locator('.nm').click()
  await expect(rows.nth(2)).toHaveClass(/on/)
  await expect(page.locator('.loopc .t')).toHaveText('Loop A1')
  await expect(page.locator('.loopc .s')).toContainText('Bars 1–8 of chorus 2')
  if (process.env.E2E_SHOTS) await page.screenshot({ path: 'test-results/shot-map.png', fullPage: true })
  await page.getByTestId('map-loop').click()
  await expect(page.locator('.loopc .t')).toHaveText('Looping bars 1–8')
  await tab(page, 'Stand').click()
  await expect(page.getByTestId('loop')).toHaveText('1–8 ✕')
  await expect(page.locator('.hero-top .lbl')).toHaveText('A1 · ch 2')
})

test('Scale coach: the next 8 changes, scale under the lens, land on the 3rd, ii–V–I tip, tap to jump', async ({ page }) => {
  await page.goto('/')
  await expect(hero(page)).toHaveText('B♭m7')
  await tab(page, 'Coach').click()
  const rows = page.locator('.ctab button.crow')
  await expect(rows).toHaveCount(8)
  await expect(rows.first()).toHaveClass(/on/)
  await expect(rows.first().locator('.ch')).toHaveText('B♭m7')
  await expect(rows.first().locator('.land')).toHaveText('D♭')
  await expect(page.getByTestId('coach-tip')).toContainText('ii–V–I into')
  await expect(page.getByTestId('coach-tip')).toContainText('Guide-tone line')
  const inside = await rows.first().locator('.scn').textContent()
  await page.locator('.lens label', { hasText: 'Colour' }).click()
  await expect(rows.first().locator('.scn')).not.toHaveText(inside!)
  if (process.env.E2E_SHOTS) await page.screenshot({ path: 'test-results/shot-coach.png', fullPage: true })
  // the lens is the same setting Stand uses
  await tab(page, 'Settings').click()
  await expect(page.locator('#set-lens-colour')).toBeChecked()
  await tab(page, 'Coach').click()
  // tap the fourth change: it becomes the current one
  const fourth = (await rows.nth(3).locator('.ch').textContent())!
  await rows.nth(3).click()
  await expect(rows.first()).toHaveClass(/on/)
  await expect(rows.first().locator('.ch')).toHaveText(fourth)
  await tab(page, 'Stand').click()
  await expect(hero(page)).toHaveText(fourth)
})

test('Share chords hands the lead sheet as text to the share sheet', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { shared: unknown[] }).shared = []
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (d: unknown) => {
        ;(window as unknown as { shared: unknown[] }).shared.push(d)
        return Promise.resolve()
      },
    })
  })
  await page.goto('/#map')
  await page.getByTestId('share-chords').click()
  await expect(page.getByTestId('share-chords')).toHaveText('Shared')
  const shared = (await page.evaluate(() => (window as unknown as { shared: Array<{ title: string; text: string }> }).shared))[0]!
  expect(shared.title).toBe('All the Things You Are')
  expect(shared.text).toContain('[A1]')
  expect(shared.text.split('\n')[0]).toContain('A♭ major')
})

test('chord style: symbols show on Stand and Coach and survive a reload', async ({ page }) => {
  await page.goto('/#settings')
  await page.locator('label', { hasText: 'Δ7 · –7' }).click()
  await tab(page, 'Stand').click()
  await expect(hero(page)).toHaveText('B♭–7')
  await page.reload()
  await expect(hero(page)).toHaveText('B♭–7')
  await tab(page, 'Coach').click()
  await expect(page.locator('.ctab button.crow').nth(3).locator('.ch')).toHaveText('Gø7')
})
