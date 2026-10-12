import { Timeline } from '@mq/model'
import { expect, test } from 'vitest'
import { demoTimeline } from '../../timeline/library'
import raw from '../../../e2e/fixtures/let-it-be.timeline.json?raw'
import { COACH_CHANGES, coachRows, coachTip, describeLine } from './plan'

const letItBe = Timeline.parse(JSON.parse(raw))

test('the next eight changes with a scale, function in the key, and the 3rd to land on', () => {
  const rows = coachRows(letItBe, 0, 'concert', 'inside')
  expect(rows).toHaveLength(COACH_CHANGES)
  expect(rows.slice(0, 4).map((r) => r.chord.symbol)).toEqual(['C', 'G', 'Am', 'F'])
  expect(rows[0]).toMatchObject({ land: 'E', fn: 'I in C major' })
  expect(rows[3]!.bar).toBeGreaterThanOrEqual(1)
  expect(rows[2]!.land).toBe('C')
  expect(rows[0]!.scale.root).toBe('C')
  // tenor: written a major 9th up, so pitch class a whole step
  expect(coachRows(letItBe, 0, 'tenor', 'inside')[0]).toMatchObject({ land: 'F♯', fn: 'I in D major' })
})

test('lenses change the scale, not the chord', () => {
  const tl = demoTimeline()
  const inside = coachRows(tl, 0, 'concert', 'inside')
  const colour = coachRows(tl, 0, 'concert', 'colour')
  expect(colour.map((r) => r.chord.symbol)).toEqual(inside.map((r) => r.chord.symbol))
  expect(colour.map((r) => r.scale.id)).not.toEqual(inside.map((r) => r.scale.id))
})

test('a ii–V–I ahead gives its guide-tone line; the line is described from its notes', () => {
  const tip = coachTip(demoTimeline(), 0, 'concert')
  expect(tip.kind).toBe('twoFive')
  if (tip.kind !== 'twoFive') return
  expect(tip.line.length).toBeGreaterThanOrEqual(2)
  expect(describeLine(['C', 'B', 'B'])).toBe('C falls a half step to B, then B holds')
  expect(describeLine(['G', 'F♯', 'F'])).toBe('G falls a half step to F♯, then F♯ falls a half step to F')
  expect(coachTip(letItBe, 0, 'concert').kind).toBe('none')
})
