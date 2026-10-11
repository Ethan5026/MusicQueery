// M5 live tests: Stand follows a mocked Spotify player (GET /me/player), shows the sync states, the not-analysed and
// nothing-playing states, turns into the lead sheet in landscape (tap a bar → seek), and calibrates a speaker.
import { readFileSync } from 'node:fs'
import { type Page, type Request, expect, test } from '@playwright/test'

const LET_IT_BE_ID = '7iN1s7xHE4ifF5povM6A48'
const UNKNOWN_ID = '0000000000000000000000'
const LET_IT_BE = readFileSync(new URL('./fixtures/let-it-be.timeline.json', import.meta.url), 'utf8')
const { chords, bars } = JSON.parse(LET_IT_BE) as {
  chords: { startMs: number; endMs: number; symbol: string }[]
  bars: { startMs: number }[]
}
const chordAt = (ms: number) => chords.find((c) => c.startMs <= ms && ms < c.endMs)!.symbol

/** A fake Spotify player on one device. Progress runs on the wall clock while playing. */
class FakePlayer {
  trackId: string | null = LET_IT_BE_ID
  playing = false
  base = 30_000
  since = Date.now()
  stamp = Date.now()
  seeks: number[] = []
  searches: string[] = []

  progress(): number {
    return this.playing ? this.base + (Date.now() - this.since) : this.base
  }
  set(patch: Partial<Pick<FakePlayer, 'trackId' | 'playing' | 'base'>>): void {
    const p = this.progress()
    Object.assign(this, { base: p, ...patch, since: Date.now(), stamp: Date.now() })
  }
  async attach(page: Page): Promise<void> {
    await page.context().route('https://api.spotify.com/v1/**', async (route) => {
      const req: Request = route.request()
      const url = new URL(req.url())
      const headers = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
      }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      const fulfill = route.fulfill.bind(route)
      route = { ...route, fulfill: (o: Parameters<typeof fulfill>[0] = {}) => fulfill({ ...o, headers: { ...headers, ...o.headers } }) } as typeof route
      if (url.pathname === '/v1/me/player' && req.method() === 'GET') {
        if (!this.trackId) return route.fulfill({ status: 204 })
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            progress_ms: Math.round(this.progress()),
            is_playing: this.playing,
            timestamp: this.stamp,
            device: { id: 'tv1', name: 'Living Room TV' },
            item: {
              id: this.trackId,
              name: this.trackId === LET_IT_BE_ID ? 'Let It Be - Remastered 2009' : 'Unknown Song',
              duration_ms: 243_026,
              artists: [{ name: this.trackId === LET_IT_BE_ID ? 'The Beatles' : 'Nobody' }],
            },
          }),
        })
      }
      if (url.pathname === '/v1/me/player/seek') {
        const ms = Number(url.searchParams.get('position_ms'))
        this.seeks.push(ms)
        this.set({ base: ms })
        return route.fulfill({ status: 204 })
      }
      if (url.pathname === '/v1/me/player/play') {
        const uri = (req.postDataJSON() as { uris?: string[] } | null)?.uris?.[0]
        this.set(uri ? { playing: true, trackId: uri.split(':')[2]!, base: 0 } : { playing: true })
        return route.fulfill({ status: 204 })
      }
      if (url.pathname === '/v1/search') {
        this.searches.push(url.searchParams.get('q') ?? '')
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            tracks: {
              items: [
                { id: LET_IT_BE_ID, name: 'Let It Be - Remastered 2009', duration_ms: 243_026, artists: [{ name: 'The Beatles' }], album: { name: 'Let It Be' } },
                { id: UNKNOWN_ID, name: 'Unknown Song', duration_ms: 180_000, artists: [{ name: 'Nobody' }], album: { name: 'X' } },
              ],
            },
          }),
        })
      }
      if (url.pathname === '/v1/me/player/pause') {
        this.set({ playing: false })
        return route.fulfill({ status: 204 })
      }
      return route.fulfill({ status: 404, body: '{}' })
    })
  }
}

let sp: FakePlayer
let queued: { token: string | null; body: unknown }[]

// WebKit can't route fetches once a service worker controls the page, so these tests run without one
// (the smoke suite's offline test covers the service worker).
test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ page }) => {
  sp = new FakePlayer()
  if (process.env.E2E_CONSOLE) {
    page.on('console', (m) => console.log('[page]', m.text().slice(0, 300)))
    page.on('response', (r) => r.status() >= 400 && console.log('[resp]', r.status(), r.request().method(), r.url()))
  }
  await sp.attach(page)
  await page.context().route(`**/api/timelines/spotify:track:${LET_IT_BE_ID}`, (r) => r.fulfill({ body: LET_IT_BE, contentType: 'application/json' }))
  await page.context().route(`**/api/timelines/spotify:track:${UNKNOWN_ID}`, (r) => r.fulfill({ status: 404, body: '{}' }))
  await page.context().route('**/api/log', (r) => r.fulfill({ status: 204 }))
  queued = []
  await page.context().route('**/api/queue/**', (r) => {
    const req = r.request()
    if (req.method() === 'GET') return r.fulfill({ status: queued.length ? 200 : 404, body: queued.length ? '{"state":"queued"}' : '' })
    queued.push({ token: req.headers()['x-spotify-token'] ?? null, body: req.postDataJSON() })
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ state: 'queued', requestedAt: new Date().toISOString() }) })
  })
  await page.addInitScript(() => {
    if (!localStorage.getItem('mq.auth.tokens'))
      localStorage.setItem(
        'mq.auth.tokens',
        JSON.stringify({ accessToken: 'x', refreshToken: 'y', expiresAt: Date.now() + 3_600_000, scope: '', grantedAt: Date.now() }),
      )
  })
})

const hero = (page: Page) => page.getByTestId('hero-chord')
const badge = (page: Page) => page.getByTestId('sync')

test('follows the track Spotify is playing: title, device, chord at its position, paused then locked', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.np-title')).toHaveText('Let It Be - Remastered 2009')
  await expect(page.locator('.np-sub')).toHaveText('The Beatles · on Living Room TV')
  await expect(hero(page)).toHaveText(chordAt(30_000))
  await expect(badge(page)).toHaveText('Paused')
  sp.set({ playing: true })
  await expect(badge(page)).toHaveText(/^±\d+ ms$/, { timeout: 8000 })
  // the chart keeps up with Spotify's position
  const pos = sp.progress() + 300
  await expect(hero(page)).toHaveText(chordAt(pos + 1500), { timeout: 4000 })
})

test('the art tile pauses Spotify; the slider seeks it', async ({ page }) => {
  sp.set({ playing: true })
  await page.goto('/')
  await expect(badge(page)).toHaveText(/^±\d+ ms$/, { timeout: 8000 })
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(badge(page)).toHaveText('Paused')
  expect(sp.playing).toBe(false)
  await page.getByLabel('Song position').evaluate((el) => {
    const input = el as HTMLInputElement
    input.value = '60000'
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect.poll(() => sp.seeks.at(-1)).toBe(60_000)
  await expect(hero(page)).toHaveText(chordAt(60_000))
})

test('a track with no timeline says so; nothing playing shows the empty state', async ({ page }) => {
  sp.set({ trackId: UNKNOWN_ID })
  await page.goto('/')
  await expect(page.getByTestId('not-analysed')).toContainText('No chords for this recording yet')
  await expect(page.locator('.np-title')).toHaveText('Unknown Song')
  // ask the PC to analyse it: the phone sends its Spotify token, the Worker queues it
  await page.getByRole('button', { name: 'Analyse on the PC' }).click()
  await expect(page.getByTestId('analyse')).toContainText('Queued')
  if (process.env.E2E_SHOTS) await page.screenshot({ path: 'test-results/shot-not-analysed.png' })
  expect(queued).toEqual([{ token: 'x', body: { title: 'Unknown Song', artist: 'Nobody' } }])
  sp.set({ trackId: null })
  await expect(page.getByTestId('nothing-playing')).toBeVisible({ timeout: 8000 })
  sp.set({ trackId: LET_IT_BE_ID })
  await expect(hero(page)).toHaveText(chordAt(30_000), { timeout: 8000 })
})

test('landscape: lead sheet + rail at the same position, tap a bar to seek', async ({ page }) => {
  await page.goto('/')
  await expect(hero(page)).toHaveText(chordAt(30_000))
  await page.setViewportSize({ width: 874, height: 402 })
  await expect(page.getByTestId('lead-sheet')).toBeVisible()
  await expect(page.locator('nav.tabs')).toBeHidden()
  await expect(page.getByTestId('rail-chord')).toHaveText(chordAt(30_000))
  const cur = page.locator('.lb.cur')
  await expect(cur).toHaveCount(1)
  await expect(cur.locator('.ph')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/lead-sheet.png' })
  // the bar after the current one: Spotify seeks to its first beat
  const idx = Number(await cur.getAttribute('data-bar')) + 1
  const start = bars[idx]!.startMs + 1
  await page.locator(`.lb[data-bar="${idx}"]`).click()
  await expect.poll(() => sp.seeks.at(-1)).toBe(start)
  await expect(page.locator(`.lb[data-bar="${idx}"]`)).toHaveClass(/cur/)
  await expect(page.getByTestId('rail-chord')).toHaveText(chordAt(start))
  // back to portrait at the same place
  await page.setViewportSize({ width: 402, height: 778 })
  await expect(hero(page)).toHaveText(chordAt(start))
})

test('calibrate from the sync badge: nudges are saved for this speaker and survive a reload', async ({ page }) => {
  sp.set({ playing: true })
  await page.goto('/')
  await expect(badge(page)).toHaveText(/^±\d+ ms$/, { timeout: 8000 })
  await badge(page).click()
  const dlg = page.getByRole('dialog', { name: 'Calibrate' })
  await expect(dlg).toContainText('Living Room TV')
  await expect(dlg.getByTestId('tap-pad')).toBeVisible()
  if (process.env.E2E_SHOTS) await page.screenshot({ path: 'test-results/shot-calibrate.png' })
  await dlg.getByRole('button', { name: 'Earlier' }).click()
  await dlg.getByRole('button', { name: 'Earlier' }).click()
  await expect(dlg).toContainText('+20 ms')
  await dlg.getByRole('button', { name: 'Done' }).click()
  await expect(dlg).toBeHidden()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mq.offsets') ?? '{}'))).toEqual({ tv1: 20 })
  await page.reload()
  await page.locator('nav.tabs').getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('section', { hasText: 'Speakers' })).toContainText('Living Room TV')
  await expect(page.locator('section', { hasText: 'Speakers' })).toContainText('+20 ms')
})

test('Tracks lists the playlist inbox with each song’s state; a failed one can be retried, an analysed one opens', async ({ page }) => {
  const FAIL = 'spotify:track:1111111111111111111111'
  await page.context().route('**/api/inbox', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        playlistId: '37i9dQZF1DXcBWIGoYBM5M',
        name: 'Practice inbox',
        updatedAt: '2026-10-11T12:00:00.000Z',
        tracks: [
          { id: `spotify:track:${LET_IT_BE_ID}`, title: 'Let It Be', artist: 'The Beatles', state: 'analysed' },
          { id: `spotify:track:${UNKNOWN_ID}`, title: 'Unknown Song', artist: 'Nobody', state: 'working' },
          { id: FAIL, title: 'Broken Song', artist: 'Somebody', state: 'failed', error: 'capture failed' },
          { id: 'spotify:track:2222222222222222222222', title: 'Just Added', artist: 'New', state: 'new' },
        ],
      }),
    }),
  )
  await page.context().route(`**/api/queue/${FAIL}`, (r) => {
    if (r.request().method() === 'GET')
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: FAIL, state: 'failed', error: 'capture failed' }) })
    queued.push({ token: r.request().headers()['x-spotify-token'] ?? null, body: r.request().postDataJSON() })
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: FAIL, state: 'queued', requestedAt: new Date().toISOString() }) })
  })
  await page.goto('/#tracks')
  const inbox = page.getByTestId('inbox')
  await expect(inbox.locator('h2')).toHaveText('Inbox · Practice inbox')
  await expect(inbox.locator('.tcount')).toHaveText('1 of 4 analysed')
  await expect(inbox.locator('.trow .src')).toHaveText(['Analysed', 'Working', 'Failed', 'Waiting'])
  // inbox songs are not listed again under "On this phone"
  await expect(page.getByRole('heading', { name: 'On this phone' })).toBeVisible()
  await expect(page.locator('.trow .tt', { hasText: 'Let It Be' })).toHaveCount(1)

  await inbox.locator('.trow', { hasText: 'Broken Song' }).click()
  await expect(page.getByTestId('analyse')).toContainText('The last try failed: capture failed')
  if (process.env.E2E_SHOTS) await page.screenshot({ path: 'test-results/shot-inbox.png', fullPage: true })
  await page.getByRole('button', { name: 'Try again on the PC' }).click()
  await expect(inbox.locator('.trow', { hasText: 'Broken Song' }).locator('.src')).toHaveText('Queued')
  expect(queued).toEqual([{ token: 'x', body: { title: 'Broken Song', artist: 'Somebody' } }])

  await inbox.locator('.trow', { hasText: 'Let It Be' }).click()
  await expect(hero(page)).toBeVisible()
})

// ---------------------------------------------------------------- M6: On Spotify and the Spotify A–B loop

test('On Spotify: search, see which results are analysed, play one and Stand follows it', async ({ page }) => {
  sp.trackId = null
  await page.context().route('**/api/status?*', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ tracks: [{ id: `spotify:track:${LET_IT_BE_ID}`, state: 'analysed' }, { id: `spotify:track:${UNKNOWN_ID}`, state: 'new' }] }),
    }),
  )
  await page.goto('/#tracks')
  await page.locator('label[for="tsrc-spot"]').click()
  await page.getByRole('button', { name: 'play-along' }).click()
  expect(sp.searches).toEqual(['play-along'])
  const rows = page.getByRole('listitem')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Analysed')
  await expect(rows.nth(1)).toContainText('Needs a listen')
  await rows.nth(0).click()
  await page.getByRole('button', { name: 'Play on Spotify' }).click()
  await expect(page.locator('.np-title')).toHaveText('Let It Be - Remastered 2009')
  await expect(badge(page)).toHaveText(/±\d+ ms|Re-syncing/)
})

test('the A–B loop on a Spotify track seeks back to A just before B', async ({ page }) => {
  // start a little before the end of the bar that holds 30 s, playing
  const i = bars.findIndex((b) => b.startMs > 30_000)
  const barStart = bars[i - 1]!.startMs
  const barEnd = bars[i]!.startMs
  sp.set({ playing: true, base: barStart + 200 })
  await page.goto('/')
  await expect(badge(page)).toHaveText(/±\d+ ms/, { timeout: 10_000 })
  await page.getByTestId('loop').click()
  await page.getByTestId('loop').click() // a one-bar loop
  await expect(page.getByTestId('loop')).toHaveText(/✕/)
  await expect.poll(() => sp.seeks.length, { timeout: 10_000 }).toBeGreaterThan(0)
  // aimed at A (less the start bias, which is 0 here), sent within a second before B
  expect(Math.abs(sp.seeks[0]! - barStart)).toBeLessThan(5)
  expect(barEnd - barStart).toBeGreaterThan(1000)
})
