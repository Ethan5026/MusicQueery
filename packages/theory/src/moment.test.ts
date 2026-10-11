import type { Timeline } from '@mq/model'
import { expect, test } from 'vitest'
import { chartTimeline } from './chart'
import { DEMO_CHART } from './demo'
import { analyseTimeline, effectiveChords, moment } from './moment'

const BEAT = 500
const base = (chords: Array<[string, number, number]>, extra: Partial<Timeline> = {}): Timeline => ({
  schema: 'mq.timeline/1',
  id: 'spotify:track:test',
  source: 'analysed',
  durationMs: 16 * BEAT,
  createdAt: '2026-10-10T00:00:00.000Z',
  meter: { num: 4, den: 4 },
  beats: Array.from({ length: 16 }, (_, i) => 1000 + i * BEAT),
  bars: [0, 1, 2, 3].map((i) => ({ startMs: 1000 + i * 4 * BEAT, number: i + 1 })),
  chords: chords.map(([symbol, s, e]) => ({ symbol, startMs: 1000 + s * BEAT, endMs: 1000 + e * BEAT })),
  keys: [],
  tempo: [{ startMs: 1000, bpm: 120 }],
  edits: [],
  ...extra,
})

test('before the first chord: nothing current, countdown to what is coming', () => {
  const tl = base([['Dm7', 0, 4], ['G7', 4, 8], ['Cmaj7', 8, 16]])
  const m = moment(tl, 0, { instrument: 'concert', lens: 'inside' })
  expect(m.chord).toBeNull()
  expect(m.eventIndex).toBe(-1)
  expect(m.next.map((n) => [n.chord.symbol, n.inBeats])).toEqual([['Dm7', 2], ['G7', 6], ['Cmaj7', 10]])
})

test('analysed timeline without keys: detects them; ii–V–I in progress', () => {
  const tl = base([['Dm7', 0, 4], ['G7', 4, 8], ['Cmaj7', 8, 16]])
  const m = moment(tl, 1000 + 5.5 * BEAT, { instrument: 'concert', lens: 'inside' })
  expect(m.chord?.symbol).toBe('G7')
  expect(m.key).toEqual({ tonic: 'C', mode: 'major' })
  expect(m.fn).toEqual({ kind: 'diatonic', text: 'V7' })
  expect(m.beatInBar).toBe(1)
  expect(m.barFraction).toBeCloseTo(1.5 / 4)
  expect(m.bar?.number).toBe(2)
  expect(m.next[0]).toMatchObject({ inBeats: 3 })
  expect(m.twoFive).toMatchObject({ start: 0, length: 3, mode: 'major', target: 'C', line: ['C', 'B', 'B'] })
  expect(m.guide?.map((g) => `${g.from}>${g.to}`)).toEqual(['B>B', 'F>E'])
  expect(m.scales?.colour.id).toBe('lyddom')
})

test('instrument views transpose chords, keys, scales and tones but not numerals', () => {
  const tl = base([['Dm7', 0, 4], ['G7', 4, 8], ['Cmaj7', 8, 16]])
  const m = moment(tl, 1000 + 9 * BEAT, { instrument: 'alto', lens: 'inside' })
  expect(m.chord).toMatchObject({ symbol: 'Amaj7', concert: 'Cmaj7', root: 'A', quality: 'maj7' })
  expect(m.key?.tonic).toBe('A')
  expect(m.fn?.text).toBe('Imaj7')
  expect(m.scale?.notes).toEqual(['A', 'B', 'C♯', 'D', 'E', 'F♯', 'G♯'])
  expect(m.tones.map((t) => t.name)).toEqual(['A', 'C♯', 'E', 'G♯'])
  expect(m.instrumentLabel).toBe('Written · E♭ alto')
})

test('user edits replace the chords they cover', () => {
  const tl = base([['Dm7', 0, 8], ['Cmaj7', 8, 16]], {
    edits: [{ at: '2026-10-10T00:00:00.000Z', startMs: 1000 + 4 * BEAT, endMs: 1000 + 8 * BEAT, symbol: 'G7' }],
  })
  expect(effectiveChords(tl).map((c) => c.symbol)).toEqual(['Dm7', 'G7', 'Cmaj7'])
  expect(moment(tl, 1000 + 6 * BEAT, { instrument: 'concert', lens: 'inside' }).chord?.symbol).toBe('G7')
})

test('saved keys win over detection', () => {
  const tl = base([['Dm7', 0, 4], ['G7', 4, 8], ['Cmaj7', 8, 16]], {
    keys: [{ startMs: 0, endMs: 99999, tonic: 'F', mode: 'major' }],
  })
  const m = moment(tl, 1000, { instrument: 'concert', lens: 'inside' })
  expect(m.key?.tonic).toBe('F')
  expect(m.fn?.text).toBe('ii7/V')
})

test('the analysis is computed once per timeline', () => {
  const tl = chartTimeline(DEMO_CHART)
  expect(analyseTimeline(tl)).toBe(analyseTimeline(tl))
})

test('N.C. has no scale', () => {
  const tl = base([['N.C.', 0, 4], ['C7', 4, 16]])
  const m = moment(tl, 1200, { instrument: 'tenor', lens: 'bebop' })
  expect(m.chord?.symbol).toBe('N.C.')
  expect(m.scale).toBeNull()
  expect(m.fn?.kind).toBe('nc')
})
