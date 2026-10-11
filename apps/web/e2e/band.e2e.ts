// M6 backing tracks: Generated → band card → Play → Stand on the band's clock (count-in, then the chords move on),
// a live tempo change, a drill in a chosen key, the A–B loop, and an iReal Pro playlist import through the Worker's
// relay (mocked here with a corpus playlist when the corpus is on this machine).
import { existsSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { FAKE_AUDIO } from './fake-audio'

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ page }) => {
  await page.addInitScript(FAKE_AUDIO)
})

const CORPUS = new URL('../../../packages/theory/corpus/blues50.txt', import.meta.url)

async function openGenerated(page: import('@playwright/test').Page) {
  await page.goto('/#tracks')
  await page.locator('label[for="tsrc-gen"]').click()
}

test('a generated tune plays on the band: count-in, then the chords move on', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openGenerated(page)
  await page.getByRole('listitem').filter({ hasText: 'Blues in F' }).click()
  const card = page.getByTestId('band-card')
  await expect(card).toBeVisible()
  await expect(page.getByTestId('band-bpm')).toHaveText('120')
  // faster, so a bar is quick: 120 → 200
  for (let i = 0; i < 16; i++) await card.getByRole('button', { name: 'Faster' }).click()
  await expect(page.getByTestId('band-bpm')).toHaveText('200')
  await page.getByTestId('band-play').click()

  await expect(page.getByTestId('hero-chord')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('sync')).toHaveText(/Count-in|Band/, { timeout: 15_000 })
  await expect(page.getByTestId('sync')).toHaveText('Band', { timeout: 10_000 })
  await expect(page.locator('.np-sub')).toContainText('Backing band')
  await expect(page.getByTestId('hero-chord')).toHaveText('F7')
  // bar 2 is B♭7: 1.2 s a bar at 200 BPM
  await expect(page.getByTestId('hero-chord')).toHaveText('B♭7', { timeout: 5_000 })
  expect(errors).toEqual([])
})

test('a drill starts in the key picked on the band card', async ({ page }) => {
  await page.goto('/#tracks')
  await page.locator('label[for="tsrc-drill"]').click()
  await page.getByRole('listitem').filter({ hasText: 'Major ii–V–I' }).click()
  await expect(page.getByTestId('band-key')).toHaveText('C')
  await page.getByRole('button', { name: 'Key up a semitone' }).click()
  await expect(page.getByTestId('band-key')).toHaveText('D♭')
  await page.getByTestId('band-play').click()
  await expect(page.getByTestId('hero-chord')).toHaveText('E♭m7', { timeout: 15_000 })
})

test('the A–B loop holds the band inside two bars', async ({ page }) => {
  await openGenerated(page)
  await page.getByRole('listitem').filter({ hasText: 'Four-chord pop' }).click()
  const card = page.getByTestId('band-card')
  for (let i = 0; i < 20; i++) await card.getByRole('button', { name: 'Faster' }).click() // 200 BPM
  await card.getByRole('button', { name: 'Count-in bars' }).click() // 1 → 2
  await card.getByRole('button', { name: 'Count-in bars' }).click() // 2 → none
  await page.getByTestId('band-play').click()
  const hero = page.getByTestId('hero-chord')
  await expect(hero).toHaveText('C', { timeout: 15_000 })
  await page.getByTestId('loop').click() // A: the bar playing now
  await page.waitForTimeout(1300) // into the next bar
  await page.getByTestId('loop').click() // B: the end of the bar playing then
  // which bars it took depends on when the clicks landed; only their chords may sound from here on
  const label = (await page.getByTestId('loop').textContent()) ?? ''
  const m = label.match(/^(\d+)–(\d+) ✕$/)
  expect(m, label).not.toBeNull()
  const [a, b] = [Number(m![1]), Number(m![2])]
  expect(b - a).toBeGreaterThanOrEqual(1)
  expect(b - a).toBeLessThanOrEqual(2)
  const PROG = ['C', 'G', 'Am', 'F']
  const want = new Set(Array.from({ length: b - a + 1 }, (_, k) => PROG[(a - 1 + k) % 4]!))
  await page.waitForTimeout(1500) // the playhead may finish the bar it was in when B was set
  const seen = new Set<string>()
  const until = Date.now() + 5000
  while (Date.now() < until) {
    seen.add((await hero.textContent()) ?? '')
    await page.waitForTimeout(100)
  }
  expect([...seen].sort()).toEqual([...want].sort())
  await page.getByTestId('loop').click()
  const outside = PROG.find((c) => !want.has(c))!
  await expect(hero).toHaveText(outside, { timeout: 6_000 })
})

test('imports an iReal Pro playlist through the relay and plays a tune from it', async ({ page }) => {
  test.skip(!existsSync(CORPUS), 'iReal corpus not fetched on this machine')
  const text = readFileSync(CORPUS, 'utf8')
  await page.route('**/api/ireal/playlists', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ playlists: [{ n: 0, name: 'Blues 50', songs: 50 }] }) }),
  )
  await page.route('**/api/ireal/playlists/0', (r) => r.fulfill({ contentType: 'text/plain', body: text }))
  await openGenerated(page)
  await page.getByRole('button', { name: 'Import iReal Pro' }).click()
  await page.getByTestId('ireal-import').getByRole('button', { name: 'Blues 50' }).click()
  await expect(page.getByTestId('ireal-msg')).toContainText(/Blues 50: \d+ added/)
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByLabel('Search tunes').fill('blues 50')
  const rows = page.getByRole('listitem')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeGreaterThan(40)
  await rows.first().click()
  await page.getByTestId('band-play').click()
  await expect(page.getByTestId('hero-chord')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('sync')).toHaveText(/Count-in|Band/, { timeout: 15_000 })
})

test('without Web Audio, Play explains instead of leaving Stand paused', async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { AudioContext?: unknown }).AudioContext)
  await openGenerated(page)
  await page.getByRole('listitem').filter({ hasText: 'Blues in F' }).click()
  await page.getByTestId('band-play').click()
  await expect(page.getByTestId('band-card')).toContainText('no Web Audio')
})
