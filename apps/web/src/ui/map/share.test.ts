import { Timeline } from '@mq/model'
import { expect, test } from 'vitest'
import { demoTimeline } from '../../timeline/library'
import raw from '../../../e2e/fixtures/let-it-be.timeline.json?raw'
import { chartText } from './share'

const letItBe = Timeline.parse(JSON.parse(raw))

test('a recording as text: header, four bars a line, two chords in a bar', () => {
  const t = chartText(letItBe, 'concert', 'Let It Be', 'text')
  const lines = t.split('\n')
  expect(lines[0]).toMatch(/^Let It Be · C major · \d+ BPM · Concert/)
  expect(lines[2]).toBe('| C G | Am F | C G | F C |')
})

test('the demo chart: rehearsal letters, key changes, % for a held bar, alto written pitch and symbols', () => {
  const t = chartText(demoTimeline(), 'alto', 'All the Things You Are', 'symbols')
  expect(t).toContain('[A1]')
  expect(t).toMatch(/\(→ .+ major\)/)
  expect(t).toContain('%')
  // B♭m7 concert is Gm7 for alto, written –7
  expect(t).toContain('G–7')
  expect(t).toMatch(/\|\|\n/)
})
