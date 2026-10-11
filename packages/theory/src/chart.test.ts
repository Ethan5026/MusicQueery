import { Chart, Timeline, type Bar } from '@mq/model'
import { expect, test } from 'vitest'
import { chartTimeline, expandChart } from './chart'
import { DEMO_CHART } from './demo'

const mk = (bars: Array<[string, Partial<Bar>?]>): Chart => ({
  schema: 'mq.chart/1',
  id: 't',
  title: 't',
  key: { tonic: 'C', mode: 'major' },
  meter: { num: 4, den: 4 },
  bars: bars.map(([s, extra]) => ({ chords: [{ symbol: s, beats: 4 }], ...extra })),
})
const order = (c: Chart): string => expandChart(c).map((b) => b.chords[0]!.symbol).join(' ')

test('schemas accept the demo chart and its timeline', () => {
  expect(Chart.parse(DEMO_CHART)).toBeTruthy()
  expect(Timeline.parse(chartTimeline(DEMO_CHART))).toBeTruthy()
})

test('plain repeat', () => {
  expect(order(mk([['A', { repeatStart: true }], ['B', { repeatEnd: 2 }], ['C']]))).toBe('A B A B C')
})

test('repeat ×3 and a repeat with no start sign', () => {
  expect(order(mk([['A'], ['B', { repeatStart: true }], ['C', { repeatEnd: 3 }]]))).toBe('A B C B C B C')
  expect(order(mk([['A'], ['B', { repeatEnd: 2 }], ['C']]))).toBe('A B A B C')
})

test('first and second endings', () => {
  const c = mk([['A', { repeatStart: true }], ['B'], ['C', { ending: 1 }], ['D', { repeatEnd: 2 }], ['E', { ending: 2 }], ['F']])
  expect(order(c)).toBe('A B C D A B E F')
})

test('three endings', () => {
  const c = mk([['A', { repeatStart: true }], ['X', { ending: 1, repeatEnd: 3 }], ['Y', { ending: 2, repeatEnd: 3 }], ['Z', { ending: 3 }]])
  expect(order(c)).toBe('A X A Y A Z')
})

test('D.C. al Coda skips repeats and takes the coda', () => {
  const c = mk([
    ['A', { repeatStart: true }], ['B', { repeatEnd: 2 }], ['C', { toCoda: true }], ['D', { jump: 'D.C. al Coda' }],
    ['E', { coda: true }], ['F'],
  ])
  expect(order(c)).toBe('A B A B C D A B C E F')
})

test('D.S. al Fine', () => {
  const c = mk([['A'], ['B', { segno: true }], ['C', { fine: true }], ['D', { jump: 'D.S. al Fine' }]])
  expect(order(c)).toBe('A B C D B C')
})

test('sections carry forward and bars number in playing order', () => {
  const p = expandChart(DEMO_CHART)
  expect(p[0]!.section).toBe('Intro')
  expect(p[4]!.section).toBe('A1')
  expect(p[4 + 36]!.section).toBe('A1')
  expect(p[4 + 36 + 16]!.section).toBe('B')
  expect(p[p.length - 1]!.section).toBe('Ending')
  expect(p.map((b) => b.number)).toEqual(p.map((_, i) => i + 1))
})

test('chartTimeline: beats, bars, merged chords, choruses', () => {
  const c = mk([['C'], ['C'], ['F'], ['G']])
  const tl = chartTimeline(c, { bpm: 120, choruses: 2 })
  expect(tl.beats).toHaveLength(32)
  expect(tl.beats[1]).toBe(500)
  expect(tl.durationMs).toBe(16000)
  expect(tl.bars.map((b) => b.pass)).toEqual([1, 1, 1, 1, 2, 2, 2, 2])
  expect(tl.chords.map((x) => [x.symbol, x.startMs, x.endMs])).toEqual([
    ['C', 0, 4000], ['F', 4000, 6000], ['G', 6000, 8000], ['C', 8000, 12000], ['F', 12000, 14000], ['G', 14000, 16000],
  ])
  expect(tl.keys.map((k) => k.tonic + ' ' + k.mode)).toEqual(['C major'])
  expect(Timeline.parse(tl).source).toBe('exact')
})

test('split bars and odd meters', () => {
  const c: Chart = {
    ...mk([['C']]),
    meter: { num: 3, den: 4 },
    bars: [{ chords: [{ symbol: 'Dm7', beats: 2 }, { symbol: 'G7', beats: 1 }] }, { chords: [{ symbol: 'C', beats: 3 }] }],
  }
  const tl = chartTimeline(c, { bpm: 60 })
  expect(tl.chords.map((x) => [x.symbol, x.startMs, x.endMs])).toEqual([['Dm7', 0, 2000], ['G7', 2000, 3000], ['C', 3000, 6000]])
  expect(tl.beats).toEqual([0, 1000, 2000, 3000, 4000, 5000])
})
