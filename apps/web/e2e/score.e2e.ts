// M10: the Lead sheet view (replaced M9's Solo). Let It Be (analysed), the demo chart (All the Things You Are: key
// changes every eight bars) and a dense human-annotated pop song (Human Nature, ~2 chords a bar) on alto and piano,
// portrait and sideways. E2E_SHOTS=1 writes the screenshots to test-results/.
import { readFileSync } from 'node:fs'
import { fromHarte } from '@mq/theory'
import { type Page, expect, test } from '@playwright/test'

const LET_IT_BE = readFileSync(new URL('./fixtures/let-it-be.timeline.json', import.meta.url), 'utf8')
const HUMAN_NATURE_ID = '4cgjA7B4fJBHyB9Ya2bu0t'

/** A McGill Billboard truth as the app would get it: Harte labels read as chord text, bars laid by the meter. */
function humanNature(): string {
  const tl = JSON.parse(readFileSync(new URL('../../../companion/truth/michael-jackson--human-nature.timeline.json', import.meta.url), 'utf8'))
  for (const c of tl.chords) c.symbol = (c.harte && fromHarte(c.harte)) || c.symbol
  tl.bars = tl.beats.filter((_: number, i: number) => i % tl.meter.num === 0).map((startMs: number, i: number) => ({ startMs, number: i + 1 }))
  tl.source = 'analysed'
  return JSON.stringify(tl)
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/timelines/spotify:track:7iN1s7xHE4ifF5povM6A48', (r) => r.fulfill({ body: LET_IT_BE, contentType: 'application/json' }))
  await page.route(`**/api/timelines/spotify:track:${HUMAN_NATURE_ID}`, (r) => r.fulfill({ body: humanNature(), contentType: 'application/json' }))
  await page.route('**/api/log', (r) => r.fulfill({ status: 204 }))
})

const tab = (page: Page, name: string) => page.locator('nav.tabs').getByRole('button', { name })
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(500) // the line change scrolls for .35 s
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `test-results/shot-${name}.png` })
}

/** Lines of staves inside the window (a piano line partly covered by the next one is still one line). */
const inView = (page: Page) =>
  page.getByTestId('score').evaluate((win) => {
    const w = win.getBoundingClientRect()
    const tops = [...win.querySelectorAll('.sc-row')]
      .map((r) => r.getBoundingClientRect())
      .filter((b) => b.bottom > w.top + 4 && b.top < w.bottom - 4)
      .map((b) => Math.round(b.top))
    return new Set(tops).size
  })

/** Which system stands on each line of the window. */
const slots = (page: Page) =>
  page.getByTestId('score').evaluate((win) =>
    Object.fromEntries([...win.querySelectorAll<HTMLElement>('.sc-row')].map((r) => [r.dataset.sys, Number(r.dataset.slot)])),
  )

async function seek(page: Page, ms: number) {
  await page.getByLabel('Song position').evaluate((el, v) => {
    const input = el as HTMLInputElement
    input.value = String(v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, ms)
}

async function openRecorded(page: Page, title: string) {
  await page.goto('/')
  await tab(page, 'Tracks').click()
  await page.getByRole('listitem').filter({ hasText: title }).click()
  await expect(page.locator('.np-title')).toHaveText(title)
}

async function openById(page: Page, id: string) {
  await page.goto('/')
  await tab(page, 'Tracks').click()
  await page.locator('#ref').fill(id)
  await page.getByRole('button', { name: 'Open', exact: true }).click()
  await expect(page.getByTestId('hero-chord')).toBeVisible()
}

test('portrait: Let It Be engraved for alto, then piano with the chord in the bass clef', async ({ page }) => {
  await openRecorded(page, 'Let It Be')
  await seek(page, 17500)
  await page.locator('label[for="pstand-score"]').click()
  const score = page.getByTestId('score')
  await expect(score).toBeVisible()
  await page.locator('label[for="sinst-alto"]').click()
  await expect(score.locator('.sc-sys').first()).toBeVisible()
  // no more than two lines in view for sax
  expect(await inView(page)).toBeLessThanOrEqual(2)
  // concert C major is written A major: three sharps in the signature, and on the notes too
  expect(await score.locator('.acc-g').count()).toBeGreaterThan(6)
  // every sharp sits on its own note: centred on the notehead it precedes (not half a space low, as the font drew it on iOS)
  const offs = await score.evaluate((win) => {
    const heads = [...win.querySelectorAll('ellipse.nh')].map((e) => e.getBoundingClientRect())
    return [...win.querySelectorAll('.acc-g:not(.sig)')].flatMap((g) => {
      if (g.querySelectorAll('path').length !== 2 || g.querySelector('.acc-f')) return [] // sharps and naturals
      const a = g.getBoundingClientRect()
      const mid = (a.top + a.bottom) / 2
      const near = heads.filter((h) => h.left - a.right > -2 && h.left - a.right < 30)
      return near.length ? [Math.min(...near.map((h) => Math.abs((h.top + h.bottom) / 2 - mid)))] : []
    })
  })
  expect(offs.length).toBeGreaterThan(3)
  expect(Math.max(...offs)).toBeLessThan(2)
  await expect(score.locator('.sc-ch').first()).toBeVisible()
  const [scroll, client] = await page.locator('main.view').evaluate((el) => [el.scrollHeight, el.clientHeight])
  expect(scroll, `content ${scroll} px in ${client} px`).toBeLessThanOrEqual(client)
  await shot(page, 'score-alto')
  await page.locator('label[for="sinst-concert"]').click()
  await expect(page.locator('.sc-cap')).toHaveText(/Piano/)
  await expect(score.locator('.sc-brace').first()).toBeVisible()
  expect(await inView(page)).toBeLessThanOrEqual(1)
  await shot(page, 'score-piano')
  await page.locator('label[for="smode-advanced"]').click()
  await shot(page, 'score-piano-advanced')
  // Chart comes back on the same switch
  await page.locator('label[for="pstand-chart"]').click()
  await expect(page.getByTestId('hero-chord')).toBeVisible()
})

test('page turns: a played line is replaced in place by the next unseen one; piano covers played bars with the next line', async ({ page }) => {
  await openRecorded(page, 'Let It Be')
  await page.locator('label[for="pstand-score"]').click()
  await page.locator('label[for="sinst-alto"]').click()
  const score = page.getByTestId('score')
  await seek(page, 0)
  await expect(score.locator('.sc-row')).toHaveCount(2)
  expect(await slots(page)).toEqual({ 0: 0, 1: 1 })
  // tap the second line: it plays where it stands, and the first line now shows the one after it
  await score.locator('.sc-row[data-sys="1"] .sc-sys').click({ position: { x: 200, y: 60 } })
  await expect(score.locator('.sc-row.cur')).toHaveAttribute('data-sys', '1')
  expect(await slots(page)).toEqual({ 1: 1, 2: 0 })
  await shot(page, 'score-page-turn')
  // piano: one line; in its last bar the bars before are covered by the next line's opening bars
  await page.locator('label[for="sinst-concert"]').click()
  const cur = score.locator('.sc-row.cur')
  const sys = await cur.getAttribute('data-sys')
  const box = (await cur.locator('.sc-sys').boundingBox())!
  await cur.locator('.sc-sys').click({ position: { x: box.width - 30, y: box.height / 2 } })
  await expect(score.locator('.sc-row.cur')).toHaveAttribute('data-sys', sys!)
  await expect(score.locator(`.sc-row.next[data-sys="${Number(sys) + 1}"]`)).toHaveCount(1)
  expect(await inView(page)).toBe(1)
  await shot(page, 'score-piano-wipe')
})

test('key changes: All the Things You Are flags the change ahead and engraves the new signature', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.np-title')).toHaveText('All the Things You Are')
  await page.locator('label[for="pstand-score"]').click()
  await page.locator('label[for="sinst-tenor"]').click()
  const score = page.getByTestId('score')
  await expect(score.locator('.sc-sys').first()).toBeVisible()
  await shot(page, 'score-attya-tenor')
  // move on until a key change comes into view
  for (const ms of [6000, 12000, 18000, 24000, 30000, 36000]) {
    await seek(page, ms)
    if (await score.locator('.sc-key.flag').count()) break
  }
  await expect(score.locator('.sc-key.flag').first()).toBeVisible()
  await shot(page, 'score-attya-tenor-change')
  await page.locator('label[for="sinst-concert"]').click()
  await shot(page, 'score-attya-piano-change')
})

test('dense pop: Human Nature at two chords a bar, alto and piano, portrait and sideways', async ({ page }) => {
  await openById(page, HUMAN_NATURE_ID)
  await seek(page, 30000)
  await page.locator('label[for="pstand-score"]').click()
  await page.locator('label[for="sinst-alto"]').click()
  const score = page.getByTestId('score')
  await expect(score.locator('.sc-ch').first()).toBeVisible()
  await shot(page, 'score-dense-alto')
  await page.locator('label[for="sinst-concert"]').click()
  await shot(page, 'score-dense-piano')
  await page.setViewportSize({ width: 874, height: 402 })
  await expect(page.getByTestId('score-sheet')).toBeVisible()
  await shot(page, 'score-dense-piano-land')
  await page.locator('label[for="linst2-alto"]').click()
  await shot(page, 'score-dense-alto-land')
  await page.locator('label[for="lstand-chart"]').click()
  await expect(page.getByTestId('lead-sheet')).toBeVisible()
  await page.setViewportSize({ width: 402, height: 778 })
})
