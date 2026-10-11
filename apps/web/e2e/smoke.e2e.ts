// M4 smoke tests in WebKit at iPhone 17 size: shell, Stand on the demo chart and on an analysed timeline,
// instrument views, settings persistence, and opening offline from the service worker + IndexedDB.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type Page, expect, test } from '@playwright/test'
import { preview } from 'vite'

const LET_IT_BE = readFileSync(new URL('./fixtures/let-it-be.timeline.json', import.meta.url), 'utf8')

test.beforeEach(async ({ page }) => {
  await page.route('**/api/timelines/spotify:track:7iN1s7xHE4ifF5povM6A48', (r) =>
    r.fulfill({ body: LET_IT_BE, contentType: 'application/json' }),
  )
  await page.route('**/api/timelines/spotify:track:0000000000000000000000', (r) => r.fulfill({ status: 404, body: '{}' }))
  await page.route('**/api/log', (r) => r.fulfill({ status: 204 }))
})

const hero = (page: Page) => page.getByTestId('hero-chord')

async function seek(page: Page, ms: number) {
  await page.getByLabel('Song position').evaluate((el, v) => {
    const input = el as HTMLInputElement
    input.value = String(v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, ms)
}

const tab = (page: Page, name: string) => page.locator('nav.tabs').getByRole('button', { name })

test('boots into Stand on the demo chart with five tabs', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('nav.tabs button')).toHaveText(['Stand', 'Tracks', 'Map', 'Coach', 'Settings'])
  await expect(page.locator('.np-title')).toHaveText('All the Things You Are')
  await expect(hero(page)).toHaveText('B♭m7')
  await expect(page.locator('.hero .src')).toHaveText('Exact')
  // bar 7 of chorus 2: Cmaj7, key change to E♭ ahead (the sketch's frame)
  await seek(page, Math.round((((4 + 36 + 6) * 4 + 1.05) * 60000) / 168))
  await expect(hero(page)).toHaveText('Cmaj7')
  await expect(page.locator('.next-h')).toContainText('Bar 7 / 36')
  await expect(page.locator('.hero-top .lbl')).toHaveText('A1 · ch 2')
  await expect(page.locator('.kc .big')).toContainText('E♭ major')
  await expect(page.locator('.scale-h b')).toHaveText('C major')
  await expect(page.locator('.staffbox svg')).toBeVisible()
  // Integrated (the default) announces the move to E♭ two bars ahead
  await expect(page.getByTestId('callout')).toContainText('E♭ major in 7 beats')
})

test('Simple, Integrated and Advanced change the Play card', async ({ page }) => {
  await page.goto('/')
  await expect(hero(page)).toHaveText('B♭m7')
  await seek(page, Math.round((((4 + 36 + 6) * 4 + 1.05) * 60000) / 168))
  await expect(hero(page)).toHaveText('Cmaj7')
  await page.locator('label[for="pmode-simple"]').click()
  await expect(page.locator('.scale-h b')).toHaveText('C major')
  await expect(page.getByTestId('callout')).toHaveCount(0)
  await expect(page.locator('.gt')).toContainText('C major pentatonic')
  await page.locator('label[for="pmode-advanced"]').click()
  await expect(page.locator('.gt')).toContainText('Guide tones into')
  // the chord-scale for C7♯5 (bar 24) differs from the key centre
  await seek(page, Math.round((((4 + 36 + 23) * 4 + 1.05) * 60000) / 168))
  await expect(hero(page)).toHaveText('C7♯5')
  await expect(page.locator('.scale-h b')).not.toHaveText(/major$/)
  await page.reload()
  await expect(page.locator('#pmode-advanced')).toBeChecked()
})

test('play runs the manual clock; pause holds it', async ({ page }) => {
  await page.goto('/')
  await expect(hero(page)).toHaveText('B♭m7')
  await page.getByRole('button', { name: 'Play' }).click()
  // the intro's first bar is 4 beats at 168 BPM ≈ 1.43 s
  await expect(hero(page)).toHaveText('E♭7', { timeout: 4000 })
  await page.getByRole('button', { name: 'Pause' }).click()
  const t = await page.locator('.prog .mono').first().textContent()
  await page.waitForTimeout(1200)
  await expect(page.locator('.prog .mono').first()).toHaveText(t!)
})

test('instrument views transpose chords, keys and scales', async ({ page }) => {
  await page.goto('/')
  await expect(hero(page)).toHaveText('B♭m7')
  await page.locator('.inst-btn').click()
  await expect(hero(page)).toHaveText('Gm7')
  await expect(page.locator('.inst-btn')).toHaveText('Written · E♭ alto')
  await expect(page.locator('.chip').first()).toContainText('F major')
  await page.locator('.inst-btn').click()
  await expect(hero(page)).toHaveText('Cm7')
  await tab(page, 'Settings').click()
  await page.locator('label', { hasText: 'Concert · piano' }).click()
  await tab(page, 'Stand').click()
  await expect(hero(page)).toHaveText('B♭m7')
})

test('opens an analysed pop timeline from the store', async ({ page }) => {
  await page.goto('/')
  await tab(page, 'Tracks').click()
  await page.getByRole('listitem').filter({ hasText: 'Let It Be' }).click()
  await expect(page.locator('.np-title')).toHaveText('Let It Be')
  await expect(page.locator('.hero .src')).toHaveText('Analysed')
  await seek(page, 66000)
  await expect(hero(page)).toHaveText('C')
  await expect(page.locator('.hero-fn')).toHaveText('I in C')
  await expect(page.locator('.kc .big')).toHaveText('None ahead')
  await expect(page.locator('.gt')).toContainText('C major pentatonic')
  await page.locator('label[for="pmode-advanced"]').click()
  await expect(page.locator('.gt')).toContainText('Chord tones')
})

test('an unanalysed track says so and keeps the open one', async ({ page }) => {
  await page.goto('/#tracks')
  await page.getByLabel('Open an analysed Spotify track').fill('https://open.spotify.com/track/0000000000000000000000?si=x')
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.locator('.tmsg')).toContainText('hasn’t been analysed')
  await tab(page, 'Stand').click()
  await expect(page.locator('.np-title')).toHaveText('All the Things You Are')
})

test('settings persist across a reload; Paper theme', async ({ page }) => {
  await page.goto('/#settings')
  await page.locator('label', { hasText: 'Paper (light)' }).click()
  await page.locator('label', { hasText: 'Bebop' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('#set-lens-bebop')).toBeChecked()
})

test('works offline: shell from the service worker, timeline from IndexedDB, fonts bundled', async ({ page }) => {
  // Airplane mode, as on the phone: the app's own server goes away. (Playwright's setOffline in WebKit fails
  // navigations before the service worker sees them, so this test runs its own preview server and stops it.)
  const server = await preview({ root: fileURLToPath(new URL('..', import.meta.url)), preview: { port: 4174, strictPort: true, host: '127.0.0.1' }, logLevel: 'silent' })
  const url = 'http://127.0.0.1:4174/'
  try {
    await page.goto(url)
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await tab(page, 'Tracks').click()
    await page.getByRole('listitem').filter({ hasText: 'Let It Be' }).click()
    await expect(page.locator('.hero .src')).toHaveText('Analysed')
    await seek(page, 66000)
    await page.getByRole('button', { name: 'Play' }).click()
    await page.getByRole('button', { name: 'Pause' }).click()
    await page.reload()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  } finally {
    await server.close()
  }
  await expect(page.request.get(url, { timeout: 2000 })).rejects.toThrow()
  await page.goto(url)
  await expect(page.locator('.np-title')).toHaveText('Let It Be')
  await expect(hero(page)).toHaveText('C')
  // every face used on the Stand finished loading with the server gone, so it came from the precache
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready
    const loaded = new Set([...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')))
    return ['Kalam', 'Barlow', 'Barlow Condensed', 'IBM Plex Mono', 'Noto Music'].map((f) => loaded.has(f))
  })
  expect(fonts).toEqual([true, true, true, true, true])
})
