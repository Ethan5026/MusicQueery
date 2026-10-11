import type { Timeline } from '@mq/model'
import { expect, test } from 'vitest'
import { demoTimeline, parseTrackRef } from '../../timeline/library'
import { barIndexAt, barPosition, homeKey, sectionLabel, tempoAt } from './view'

const demo = demoTimeline()
const beatMs = 60000 / 168
const barAt = (bar: number) => barIndexAt(demo, bar * 4 * beatMs + 1)

test('demo: home key A♭, written for the saxes', () => {
  expect(homeKey(demo, 'concert')).toEqual({ tonic: 'A♭', mode: 'major' })
  expect(homeKey(demo, 'alto')).toEqual({ tonic: 'F', mode: 'major' })
  expect(homeKey(demo, 'tenor')).toEqual({ tonic: 'B♭', mode: 'major' })
})

test('demo: bars count within the chorus, sections carry the chorus number', () => {
  expect(barPosition(demo, barAt(0))).toEqual({ n: 1, total: 188 })
  expect(sectionLabel(demo, barAt(0))).toBe('Intro')
  // intro is 4 bars; bar 7 of chorus 2 is played bar 4 + 36 + 6
  const i = barAt(4 + 36 + 6)
  expect(barPosition(demo, i)).toEqual({ n: 7, total: 36 })
  expect(sectionLabel(demo, i)).toBe('A1 · ch 2')
  expect(sectionLabel(demo, barAt(4 + 36 * 5))).toBe('Ending')
})

test('analysed: no sections, bars count through the track, tempo follows the map', () => {
  const tl: Timeline = {
    schema: 'mq.timeline/1',
    id: 'spotify:track:7iN1s7xHE4ifF5povM6A48',
    source: 'analysed',
    durationMs: 9000,
    createdAt: '2026-10-11T00:00:00.000Z',
    meter: { num: 4, den: 4 },
    beats: [],
    bars: [
      { startMs: 140, number: 1 },
      { startMs: 3460, number: 2 },
      { startMs: 6780, number: 3 },
    ],
    chords: [],
    keys: [
      { startMs: 0, endMs: 2000, tonic: 'F', mode: 'major' },
      { startMs: 2000, endMs: 9000, tonic: 'C', mode: 'major' },
    ],
    tempo: [
      { startMs: 0, bpm: 73.2 },
      { startMs: 5000, bpm: 76.9 },
    ],
    edits: [],
  }
  expect(homeKey(tl, 'concert')).toEqual({ tonic: 'C', mode: 'major' })
  expect(barIndexAt(tl, 100)).toBe(-1)
  expect(barPosition(tl, barIndexAt(tl, 4000))).toEqual({ n: 2, total: 3 })
  expect(sectionLabel(tl, 1)).toBeNull()
  expect(tempoAt(tl, 4000)).toBe(73)
  expect(tempoAt(tl, 5000)).toBe(77)
})

test('track refs from links, URIs and IDs', () => {
  const id = 'spotify:track:7iN1s7xHE4ifF5povM6A48'
  expect(parseTrackRef('https://open.spotify.com/track/7iN1s7xHE4ifF5povM6A48?si=abc123')).toBe(id)
  expect(parseTrackRef('spotify:track:7iN1s7xHE4ifF5povM6A48')).toBe(id)
  expect(parseTrackRef(' 7iN1s7xHE4ifF5povM6A48 ')).toBe(id)
  expect(parseTrackRef('let it be')).toBeNull()
})
