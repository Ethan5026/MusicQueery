// Snapshot parity with the approved sketch: the sketch's own engine (verbatim in __sketch__/engine.ts)
// and @mq/theory must agree on every chord of the demo tune, for every instrument and lens.
import { describe, expect, test } from 'vitest'
import * as S from './__sketch__/engine'
import { DEMO_CHART, DEMO_FORM_REGIONS } from './demo'
import { chartTimeline } from './chart'
import { analyseTimeline, moment } from './moment'
import { INSTRUMENT_IDS, type InstrumentId } from './instrument'
import { LENSES } from './scales'
import { findTwoFives } from './guide'
import { noteName, note, pc } from './pitch'

const tl = chartTimeline(DEMO_CHART, { createdAt: '2026-10-10T00:00:00.000Z' })
const a = analyseTimeline(tl)
const BEAT_MS = 60000 / 168
const pcs = (ns: string[]): number[] => ns.map((n) => pc(note(n)))

test('same events: count, symbols, start beats', () => {
  expect(a.events.length).toBe(S.EV.length)
  expect(a.events.map((e) => e.symbol)).toEqual(S.EV.map((e) => e.sym))
  expect(a.events.map((e) => e.startBeat)).toEqual(S.EV.map((e: { start: number }) => e.start))
})

test('auto key regions equal the sketch\'s hand-marked regions', () => {
  expect(a.events.map((e) => noteName(e.key.tonic))).toEqual(S.EV.map((e: { reg: string }) => e.reg))
  expect(a.events.every((e) => e.key.mode === 'major')).toBe(true)
  expect(DEMO_FORM_REGIONS).toHaveLength(36)
})

test('auto harmonic functions equal the sketch\'s numerals and hand annotations', () => {
  expect(a.events.map((e) => e.fn.text)).toEqual(S.EV.map((e: { fn: string }) => e.fn))
})

describe.each(INSTRUMENT_IDS)('%s', (inst: InstrumentId) => {
  test.each(S.EV.map((_: unknown, i: number) => i))('event %i', (i: number) => {
    S.setInst(inst)
    const ev = S.EV[i]
    const b = ev.start + 0.5
    const s = S.at(b)
    for (const lens of LENSES) {
      const m = moment(tl, b * BEAT_MS, { instrument: inst, lens })
      expect(m.eventIndex).toBe(s.i)
      expect(m.chord?.symbol).toBe(S.tsym(ev.sym))
      expect(m.key?.tonic).toBe(S.tn(ev.reg))
      expect(m.fn?.text).toBe(ev.fn)
      expect(m.beatInBar).toBe(s.beatIn)
      expect(m.bar?.number).toBe(s.ab + 1)
      expect(m.next.map((n) => [n.chord.symbol, n.inBeats])).toEqual(
        S.EV.slice(s.i + 1, s.i + 5).map((e: { sym: string; start: number }) => [S.tsym(e.sym), Math.ceil(e.start - s.b)]),
      )
      const kc = S.nextChange(s)
      expect(m.keyChange ? [m.keyChange.to.tonic, m.keyChange.inBeats, m.keyChange.chord.symbol] : null).toEqual(
        kc ? [S.tn(kc.reg), Math.ceil(kc.start - s.b), S.tsym(kc.sym)] : null,
      )
      const id = S.pickScale(ev.sym, ev.reg, ev.next, lens)
      expect(m.scale?.id).toBe(id)
      expect(m.scale?.name).toBe(S.SCALES[id][0])
      const want = S.scaleNotes(S.tn(S.parseChord(ev.sym).root), id)
      // Deliberate change: the altered scale is spelled from the chord (C D♭ D♯ E F♯ A♭ B♭); same pitches.
      if (id === 'altered') expect(pcs(m.scale!.notes)).toEqual(pcs(want))
      else expect(m.scale?.notes).toEqual(want)
      expect(m.tones.map((t) => t.name)).toEqual(S.chordTones(S.tsym(ev.sym)))
      const g = S.guide(ev)
      expect(m.guide ? m.guide.map((x) => [x.from, x.fromSlot, x.to, x.toSlot]) : null).toEqual(g)
    }
  })
})

test('ii–V–I spans match the sketch\'s Coach search from every chord', () => {
  S.setInst('concert')
  const spans = findTwoFives(a.events.map((e) => e.chord)).filter((t) => t.length === 3)
  for (let i = 0; i < S.EV.length; i++) {
    const want = S.coachTwoFive(i)
    const got = spans.find((t) => t.start >= i && t.start < Math.min(S.EV.length - 2, i + 8))
    expect(got ? [got.start, got.line.map((n) => noteName(n)), noteName(got.target), got.mode] : null).toEqual(want)
  }
})
