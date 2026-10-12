import { Timeline } from '@mq/model'
import { expect, test } from 'vitest'
import { demoTimeline } from '../../timeline/library'
import raw from '../../../e2e/fixtures/let-it-be.timeline.json?raw'
import { BARS_PER_ROW, buildMap, keyHue, loopSpan } from './map'

const letItBe = Timeline.parse(JSON.parse(raw))

test('demo chart: intro, one row per chorus, ending; rehearsal letters as ticks; key areas over one chorus', () => {
  const tl = demoTimeline()
  const map = buildMap(tl, 'concert')
  const names = map.rows.map((r) => r.name)
  expect(names[0]).toBe('Intro')
  expect(names[1]).toBe('Chorus 1')
  expect(names.filter((n) => n.startsWith('Chorus')).length).toBeGreaterThanOrEqual(2)
  const chorus = map.rows[1]!
  expect(chorus.bars).toHaveLength(36)
  expect(map.widest).toBe(36)
  expect(chorus.ticks.map((t) => t.label)).toEqual(['A1', 'A2', 'B', 'A3'])
  expect(chorus.ticks.map((t) => t.at)).toEqual([0, 8, 16, 24])
  expect(map.rows.flatMap((r) => r.bars)).toHaveLength(tl.bars.length)
  expect(map.keysScope).toBe('chorus')
  expect(map.keys[0]!.home).toBe(true)
  expect(map.keys.reduce((n, k) => n + k.bars, 0)).toBeLessThanOrEqual(36)
  expect(map.keys.map((k) => k.name)).toContain('E♭ major')
  // the section around a bar of the bridge
  const bridge = chorus.bars[18]!.index
  const span = loopSpan(tl, map, bridge)!
  expect(span.label).toBe('B')
  expect(span.to - span.from + 1).toBe(8)
  expect(span.from).toBe(chorus.bars[16]!.index)
})

test('analysed pop without passes: rows of 16 bars named by time, key areas over the track, 8-bar loop phrases', () => {
  const map = buildMap(letItBe, 'concert')
  expect(map.rows[0]!.bars).toHaveLength(BARS_PER_ROW)
  expect(map.rows[0]!.name).toBe('0:00')
  expect(map.rows[0]!.sub).toMatch(/^bars 1–16$/)
  expect(map.keysScope).toBe('track')
  expect(map.keys[0]).toMatchObject({ name: 'C major', home: true })
  const span = loopSpan(letItBe, map, 10)!
  expect([span.from, span.to]).toEqual([8, 15])
})

test('alto names the keys written; colours stay concert, and a minor key takes its relative major’s hue', () => {
  expect(buildMap(letItBe, 'alto').keys[0]!.name).toBe('A major')
  expect(keyHue(9, 'minor')).toBe(keyHue(0, 'major'))
  expect(keyHue(7, 'major')).not.toBe(keyHue(0, 'major'))
})
