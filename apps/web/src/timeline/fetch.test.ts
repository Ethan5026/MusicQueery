import { expect, test } from 'vitest'
import { chordAt, fetchTimeline } from './fetch'

const tl = {
  schema: 'mq.timeline/1',
  id: 'spotify:track:7pKfPomDEeI4TPT6EOYjn9',
  source: 'analysed',
  durationMs: 4000,
  createdAt: '2026-10-11T00:00:00.000Z',
  meter: { num: 4, den: 4 },
  beats: [0, 1000, 2000, 3000],
  bars: [{ startMs: 0, number: 1 }],
  chords: [
    { startMs: 0, endMs: 2000, symbol: 'C' },
    { startMs: 2000, endMs: 4000, symbol: 'Fmaj7' },
  ],
  keys: [],
  tempo: [{ startMs: 0, bpm: 60 }],
  edits: [],
}
const fake = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

test('fetchTimeline validates and reports missing or broken timelines', async () => {
  const ok = await fetchTimeline('7pKfPomDEeI4TPT6EOYjn9', fake(200, tl))
  expect(ok.status).toBe('ok')
  expect((await fetchTimeline('x', fake(404, 'not found'))).status).toBe('missing')
  const bad = await fetchTimeline('x', fake(200, { ...tl, source: 'guess' }))
  expect(bad.status).toBe('error')
})

test('chordAt finds the sounding chord', async () => {
  const r = await fetchTimeline('x', fake(200, tl))
  if (r.status !== 'ok') throw new Error('fetch failed')
  expect(chordAt(r.timeline, 0)?.symbol).toBe('C')
  expect(chordAt(r.timeline, 2500)?.symbol).toBe('Fmaj7')
  expect(chordAt(r.timeline, 4000)).toBeNull()
})
