import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { Chart, MODEL_VERSION, NoteName, Timeline, jsonSchemas } from './index'

const chart = {
  schema: 'mq.chart/1',
  id: 'x',
  title: 'Blue Bossa',
  key: { tonic: 'C', mode: 'minor' },
  meter: { num: 4, den: 4 },
  bars: [{ chords: [{ symbol: 'Cm7', beats: 4 }], section: 'A', repeatStart: true }, { chords: [{ symbol: 'Fm7', beats: 4 }], repeatEnd: 2 }],
}

const timeline = {
  schema: 'mq.timeline/1',
  id: 'spotify:track:abc',
  source: 'analysed',
  durationMs: 4000,
  createdAt: '2026-10-10T12:00:00.000Z',
  meter: { num: 4, den: 4 },
  beats: [0, 500, 1000, 1500],
  bars: [{ startMs: 0, number: 1 }],
  chords: [{ startMs: 0, endMs: 2000, symbol: 'Dm7', confidence: 0.8 }],
  keys: [{ startMs: 0, endMs: 4000, tonic: 'C', mode: 'major' }],
  tempo: [{ startMs: 0, bpm: 120 }],
}

test('version', () => {
  expect(MODEL_VERSION).toBe(1)
})

test('valid chart and timeline parse; edits default to []', () => {
  expect(Chart.parse(chart).bars).toHaveLength(2)
  expect(Timeline.parse(timeline).edits).toEqual([])
})

test.each(['C', 'E♭', 'F♯', 'B♭♭', 'G♯♯'])('note name %s is valid', (n) => {
  expect(NoteName.safeParse(n).success).toBe(true)
})

test.each(['Eb', 'H', 'c', 'C♭♭♭', 'C#'])('note name %s is rejected', (n) => {
  expect(NoteName.safeParse(n).success).toBe(false)
})

test.each([
  ['wrong schema tag', { ...chart, schema: 'mq.chart/2' }],
  ['no bars', { ...chart, bars: [] }],
  ['empty bar', { ...chart, bars: [{ chords: [] }] }],
  ['zero-beat chord', { ...chart, bars: [{ chords: [{ symbol: 'C', beats: 0 }] }] }],
  ['bad meter', { ...chart, meter: { num: 4, den: 3 } }],
  ['repeat once', { ...chart, bars: [{ chords: [{ symbol: 'C', beats: 4 }], repeatEnd: 1 }] }],
  ['bad jump', { ...chart, bars: [{ chords: [{ symbol: 'C', beats: 4 }], jump: 'D.C. al Segno' }] }],
])('chart rejected: %s', (_, c) => {
  expect(Chart.safeParse(c).success).toBe(false)
})

test.each([
  ['bad source', { ...timeline, source: 'guessed' }],
  ['bad date', { ...timeline, createdAt: 'yesterday' }],
  ['confidence > 1', { ...timeline, chords: [{ startMs: 0, endMs: 1, symbol: 'C', confidence: 2 }] }],
  ['bad key tonic', { ...timeline, keys: [{ startMs: 0, endMs: 1, tonic: 'Bb', mode: 'major' }] }],
  ['bar number 0', { ...timeline, bars: [{ startMs: 0, number: 0 }] }],
])('timeline rejected: %s', (_, t) => {
  expect(Timeline.safeParse(t).success).toBe(false)
})

test('committed JSON Schema files are up to date (run: pnpm --filter @mq/model schema)', () => {
  for (const [name, schema] of Object.entries(jsonSchemas())) {
    const file = readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8')
    expect(JSON.parse(file)).toEqual(schema)
  }
})
