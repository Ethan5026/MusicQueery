import type { MelodyNote, Timeline } from '@mq/model'
import { note } from '@mq/theory'
import { expect, test } from 'vitest'
import { melodyPcs, octaveShift, soloLine, soloWindow, spellIn, staffPos } from './melody'

/** Four bars of 4/4 at 120 BPM: E♭ major, then two bars of C minor. Melody in concert MIDI. */
function tl(melody: Array<[number, number, number, number?]>): Timeline {
  return {
    schema: 'mq.timeline/1',
    id: 'spotify:track:7iN1s7xHE4ifF5povM6A48',
    source: 'analysed',
    durationMs: 8000,
    createdAt: '2026-10-11T00:00:00.000Z',
    meter: { num: 4, den: 4 },
    beats: Array.from({ length: 16 }, (_, i) => i * 500),
    bars: [0, 2000, 4000, 6000].map((startMs, i) => ({ startMs, number: i + 1 })),
    chords: [
      { startMs: 0, endMs: 4000, symbol: 'E♭' },
      { startMs: 4000, endMs: 8000, symbol: 'Cm' },
    ],
    keys: [
      { startMs: 0, endMs: 4000, tonic: 'E♭', mode: 'major' },
      { startMs: 4000, endMs: 8000, tonic: 'C', mode: 'minor' },
    ],
    tempo: [{ startMs: 0, bpm: 120 }],
    edits: [],
    melody: melody.map(([startMs, endMs, midi, confidence]): MelodyNote => ({ startMs, endMs, midi, ...(confidence === undefined ? {} : { confidence }) })),
  }
}

test('spelling follows the key: flats in E♭, the raised 7th of C minor is B♮, ♯4 is a sharp', () => {
  expect(spellIn(70, note('E♭'))).toEqual(note('B♭'))
  expect(spellIn(71, note('C'))).toEqual(note('B'))
  expect(spellIn(66, note('C'))).toEqual(note('F♯'))
  expect(spellIn(63, note('C'))).toEqual(note('E♭'))
  // no double sharps: the ♯4 of F♯ major is B♯, the ♭2 of A♭ is B𝄫 → A
  expect(spellIn(60, note('F♯'))).toEqual(note('B♯'))
  expect(spellIn(69, note('A♭'))).toEqual(note('A'))
})

test('staff positions: middle C 28, B♯3 on B3, C♭5 on C5', () => {
  expect(staffPos(note('C'), 60)).toBe(28)
  expect(staffPos(note('E'), 64)).toBe(30)
  expect(staffPos(note('B♯'), 60)).toBe(27)
  expect(staffPos(note('C♭'), 71)).toBe(35)
})

test('one octave shift for the whole line, centred in the comfortable range', () => {
  expect(octaveShift([48, 50, 52, 55], 62, 84)).toBe(24)
  expect(octaveShift([70, 72, 74], 60, 81)).toBe(0)
  expect(octaveShift([], 60, 81)).toBe(0)
})

test('alto: concert E♭ major is written C major; the line keeps its shape', () => {
  const line = soloLine(tl([[0, 500, 63], [500, 1000, 67], [1000, 2000, 70], [4000, 4500, 71, 0.3]]), 'alto')
  expect(line.notes.map((n) => n.name)).toEqual(['C', 'E', 'G', 'G♯'])
  const m = line.notes.map((n) => n.midi)
  expect(m[1]! - m[0]!).toBe(4)
  expect(m[2]! - m[0]!).toBe(7)
  expect(line.notes[3]!.faint).toBe(true)
  expect(line.notes[0]!.startBeat).toBe(0)
  expect(line.notes[2]!.endBeat).toBe(4)
})

test('window: notes overlapping the span, a rest in every empty beat, the pitch classes played', () => {
  const line = soloLine(tl([[0, 500, 63], [500, 1000, 67], [3000, 3500, 70]]), 'concert')
  const w = soloWindow(line.notes, 0, 8)
  expect(w.notes).toHaveLength(3)
  expect(w.rests).toEqual([2.5, 3.5, 4.5, 5.5, 7.5])
  expect([...melodyPcs(line.notes, 0, 2)].sort()).toEqual([3, 7])
})
