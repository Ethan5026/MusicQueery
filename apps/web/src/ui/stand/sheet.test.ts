import { Timeline } from '@mq/model'
import { expect, test } from 'vitest'
import { demoTimeline } from '../../timeline/library'
import raw from '../../../e2e/fixtures/let-it-be.timeline.json?raw'
import { buildSheet, topRow } from './sheet'

const letItBe = Timeline.parse(JSON.parse(raw))

test('analysed pop: four bars a line, two chords split by duration, home key on the first bar', () => {
  const { rows, rowOf } = buildSheet(letItBe, 'concert')
  expect(rows[0]).toHaveLength(4)
  expect(rows.flat()).toHaveLength(letItBe.bars.length)
  const b1 = rows[0]![0]!
  expect(b1.chords.map((c) => c.chord.symbol)).toEqual(['C', 'G'])
  expect(b1.chords[0]!.held).toBe(false)
  expect(b1.chords[0]!.share).toBeCloseTo(0.5, 1)
  expect(b1.kmark).toEqual({ text: 'C major', home: true })
  expect(rows[0]![1]!.chords.map((c) => c.chord.symbol)).toEqual(['Am', 'F'])
  expect(rows[0]![1]!.kmark).toBeNull()
  expect(rowOf[5]).toBe(1)
  expect(rows.at(-1)!.at(-1)!.end).toBe(true)
})

test('alto: chords and key marks written a major sixth up', () => {
  const b1 = buildSheet(letItBe, 'alto').rows[0]![0]!
  expect(b1.chords.map((c) => c.chord.symbol)).toEqual(['A', 'E'])
  expect(b1.kmark?.text).toBe('A major')
})

test('demo chart: rehearsal letters start lines, passes end in a double bar, key changes are marked', () => {
  const { rows } = buildSheet(demoTimeline(), 'concert')
  const bars = rows.flat()
  expect(rows[0]![0]!.reh).toBe('Intro')
  // the intro is 4 bars, so chorus 1 starts the second line with A1
  expect(rows[1]![0]!.reh).toBe('A1')
  expect(rows.every((r) => r.length <= 4)).toBe(true)
  expect(rows.every((r, i) => i === 0 || r[0]!.reh !== null || rows[i - 1]!.length === 4)).toBe(true)
  expect(bars.filter((b) => b.end).length).toBeGreaterThanOrEqual(5)
  expect(bars.filter((b) => b.kmark && !b.kmark.home).map((b) => b.kmark!.text)).toContain('→ E♭ major')
  // a two-bar chord (Cmaj7 at the end of A1) shows again, held, in its second bar
  expect(bars.some((b) => b.chords.length === 1 && b.chords[0]!.held && b.chords[0]!.chord.symbol === 'Cmaj7')).toBe(true)
})

test('the current row sits second from the top', () => {
  expect(topRow(0, 30, 4)).toBe(0)
  expect(topRow(1, 30, 4)).toBe(0)
  expect(topRow(5, 30, 4)).toBe(4)
  expect(topRow(29, 30, 4)).toBe(26)
  expect(topRow(2, 3, 4)).toBe(0)
})
