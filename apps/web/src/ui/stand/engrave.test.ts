import { Timeline } from '@mq/model'
import { chord, note } from '@mq/theory'
import { expect, test } from 'vitest'
import raw from '../../../e2e/fixtures/let-it-be.timeline.json?raw'
import { bassStack, engrave, fifthsOf, layout, noteValues, rotateTo, sigAccs } from './engrave'

const letItBe = Timeline.parse(JSON.parse(raw))

/** Four bars at 120 BPM: E♭ major, a 2/4 bar, then C minor with a D7 swapping F♯ in. */
function tl(): Timeline {
  const beats = Array.from({ length: 14 }, (_, i) => i * 500)
  return {
    schema: 'mq.timeline/1',
    id: 'chart:test',
    source: 'exact',
    durationMs: 7000,
    createdAt: '2026-10-18T00:00:00.000Z',
    meter: { num: 4, den: 4 },
    beats,
    bars: [0, 2000, 3000, 5000].map((startMs, i) => ({ startMs, number: i + 1 })),
    chords: [
      { startMs: 0, endMs: 3000, symbol: 'E♭' },
      { startMs: 3000, endMs: 4000, symbol: 'Cm' },
      { startMs: 4000, endMs: 5000, symbol: 'D7' },
      { startMs: 5000, endMs: 7000, symbol: 'Cm' },
    ],
    keys: [
      { startMs: 0, endMs: 3000, tonic: 'E♭', mode: 'major' },
      { startMs: 3000, endMs: 7000, tonic: 'C', mode: 'minor' },
    ],
    tempo: [{ startMs: 0, bpm: 120 }],
    edits: [],
  }
}

test('signatures: sharps and flats per key, minor keys read their relative major, theoretical keys respelled', () => {
  expect(fifthsOf(note('E♭'), 'major')).toBe(-3)
  expect(fifthsOf(note('C'), 'minor')).toBe(-3)
  expect(fifthsOf(note('A'), 'major')).toBe(3)
  expect(fifthsOf(note('G♯'), 'major')).toBe(-4)
  expect(sigAccs(2)).toEqual([1, 0, 0, 1, 0, 0, 0])
})

test('note values: exact lengths, dotted where they fit, tied otherwise', () => {
  expect(noteValues(4, 4)).toEqual([{ at: 0, base: 1, dots: 0 }])
  expect(noteValues(3, 4)).toEqual([{ at: 0, base: 0.5, dots: 1 }])
  expect(noteValues(2.5, 4).map((v) => [v.base, v.dots])).toEqual([[0.5, 0], [0.125, 0]])
  expect(noteValues(6, 8)).toEqual([{ at: 0, base: 0.5, dots: 1 }])
})

test('bass stack: root position upwards, slash bass under the root', () => {
  expect(bassStack(chord('Cmaj7')).map((n) => n.name)).toEqual(['C', 'E', 'G', 'B'])
  const ce = bassStack(chord('C/E'))
  expect(ce.map((n) => n.name)).toEqual(['E', 'C', 'E', 'G'])
  expect(ce[0]!.p).toBeLessThan(ce[1]!.p)
  expect(rotateTo(['C', 'D', 'E', 'F', 'G', 'A', 'B'], 'A')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
})

test('measures: meters from the beat grid, key changes signed, runs of one scale, every accidental written', () => {
  const sc = engrave(tl(), 'concert', 'integrated', 'inside')
  const [m1, m2, m3, m4] = sc.measures
  expect(m1!.showMeter).toBe(true)
  expect(m2!.meter).toEqual({ num: 2, den: 4 })
  expect(m2!.showMeter).toBe(true)
  expect(m3!.meter).toEqual({ num: 4, den: 4 })
  expect(m3!.showMeter).toBe(true)
  expect(m1!.sig).toEqual({ fifths: -3, name: 'E♭ major' })
  expect(m3!.keyChange).toBe(true)
  expect(m3!.sigChange).toBe(false) // C minor shares E♭ major's signature
  expect(m3!.sig.name).toBe('C minor')
  // E♭ major from its root, the flats written though the signature has them
  expect(m1!.runs).toHaveLength(1)
  expect(m1!.runs[0]!.notes.map((n) => n.name)).toEqual(['E♭', 'F', 'G', 'A♭', 'B♭', 'C', 'D'])
  expect(m1!.runs[0]!.notes.map((n) => n.glyph)).toEqual(['♭', '', '', '♭', '♭', '', ''])
  // Cm then D7: two runs, the D7's F♯ and A in rust, the A a natural against the signature
  expect(m3!.runs).toHaveLength(2)
  const d7 = m3!.runs[1]!.notes
  expect(d7[0]!.name).toBe('D')
  expect(d7.find((n) => n.name === 'F♯')!.role).toBe('x')
  expect(d7.find((n) => n.name === 'A')!.glyph).toBe('♮')
  // piano: the E♭ chord held over the bar line is tied
  expect(m1!.bass[0]!.tieOut).toBe(true)
  expect(m2!.bass[0]!.tieIn).toBe(true)
  expect(m4!.chords[0]!.chord.symbol).toBe('Cm')
})

test('Let It Be: one run a bar over C G, bar repeats spotted, systems fill the width', () => {
  const sc = engrave(letItBe, 'alto', 'simple', 'inside')
  const m1 = sc.measures[0]!
  expect(m1.chords.map((c) => c.chord.symbol)).toEqual(['A', 'E'])
  expect(m1.runs).toHaveLength(1)
  expect(m1.sig).toEqual({ fifths: 3, name: 'A major' })
  expect(m1.runs[0]!.notes.filter((n) => n.glyph === '♯')).toHaveLength(3)
  const { systems, systemOf } = layout(sc, 34)
  expect(systems.length).toBeGreaterThan(10)
  expect(systemOf).toHaveLength(letItBe.bars.length)
  for (const s of systems.slice(0, -1)) expect(s.width).toBeCloseTo(34, 0)
})
