import { moment } from '@mq/theory'
import { expect, test } from 'vitest'
import { demoTimeline } from '../../timeline/library'
import { beatsUntil, nextChange } from './next'
import { playView } from './play'

const demo = demoTimeline()
const beatMs = 60000 / 168
/** ms at `beat` of played bar `bar` (0-based) */
const at = (bar: number, beat = 0) => Math.round((bar * 4 + beat + 0.05) * beatMs)
const prefs = { instrument: 'concert', lens: 'inside' } as const

test('simple: Next is the next key, with the new notes marked, skipping chords in the same key', () => {
  // chorus 2, bar 1 (Fm7) in A♭ major: the next key is C major at bar 6 (G7)
  const m = moment(demo, at(4 + 36), prefs)
  const r = nextChange(demo, m, 'simple', prefs)
  expect(r.next?.view.title).toBe('C major')
  expect(r.next?.chord?.symbol).toBe('G7')
  expect(r.next?.changed.sort()).toEqual(['A', 'B', 'D', 'E'])
  expect(r.next?.view.notes.filter((n) => n.role === 'x').map((n) => n.name).sort()).toEqual(['A', 'B', 'D', 'E'])
  expect(r.next?.view.notes.filter((n) => n.role !== 'x').every((n) => n.role === '')).toBe(true)
  expect(beatsUntil(r.next!.startBeat, m.beat)).toBe(20)
})

test('integrated: Now stays in the current key right up to the change', () => {
  const m = moment(demo, at(4 + 36 + 4, 3), prefs) // last beat of bar 5, one beat before G7
  expect(playView(m, 'integrated')?.title).toBe('C major') // the portrait preview
  expect(playView(m, 'integrated', { preview: false })?.title).toBe('A♭ major')
  expect(nextChange(demo, m, 'integrated', prefs).next?.view.title).toBe('C major')
})

test('advanced: chords that share notes are skipped', () => {
  const m = moment(demo, at(4 + 36), prefs) // Fm7
  const r = nextChange(demo, m, 'advanced', prefs)
  expect(r.next).not.toBeNull()
  expect(r.next!.eventIndex).toBeGreaterThan(m.eventIndex)
  expect(r.next!.changed.length).toBeGreaterThan(0)
})

test('no change within the lookahead reports how far it looked', () => {
  const m = moment(demo, at(4 + 36), prefs)
  const r = nextChange(demo, m, 'simple', prefs, 2)
  expect(r.next).toBeNull()
  expect(r.lastEventIndex).toBe(m.eventIndex + 2)
})
