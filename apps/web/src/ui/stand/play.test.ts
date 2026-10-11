import { type Chart, Timeline } from '@mq/model'
import { chartTimeline, moment } from '@mq/theory'
import { expect, test } from 'vitest'
import { demoTimeline } from '../../timeline/library'
import fixture from '../../../e2e/fixtures/let-it-be.timeline.json'
import { alterScale, keyScale, playView } from './play'

const prefs = { instrument: 'concert', lens: 'inside' } as const
const letItBe = Timeline.parse(fixture)

const names = (v: ReturnType<typeof playView>, role?: string) => v!.notes.filter((n) => role === undefined || n.role === role).map((n) => n.name)

test('key scales: major and natural minor', () => {
  expect(keyScale({ tonic: 'E♭', mode: 'major' })).toEqual(['E♭', 'F', 'G', 'A♭', 'B♭', 'C', 'D'])
  expect(keyScale({ tonic: 'F', mode: 'minor' })).toEqual(['F', 'G', 'A♭', 'B♭', 'C', 'D♭', 'E♭'])
})

test('outside notes replace the note on the same letter', () => {
  const c = keyScale({ tonic: 'C', mode: 'major' })
  expect(alterScale(c, ['F♯'])).toEqual({ notes: ['C', 'D', 'E', 'F♯', 'G', 'A', 'B'], changed: ['F♯'] })
  expect(alterScale(c, ['B♭', 'E♭']).changed).toEqual(['B♭', 'E♭'])
})

test('simple: the key centre with its pentatonic, whatever the chord', () => {
  const m = moment(letItBe, 66000, prefs)
  const v = playView(m, 'simple')!
  expect(v.title).toBe('C major')
  expect(v.sub).toBe('C major pentatonic')
  expect(v.chord).toBeNull()
  expect(names(v)).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B'])
  expect(names(v, 't')).toEqual(['C', 'D', 'E', 'G', 'A'])
  expect(v.callout).toBeNull()
})

test('advanced: the chord-scale with the chord stacked', () => {
  const m = moment(letItBe, 66000, prefs)
  const v = playView(m, 'advanced')!
  expect(v.title).toBe('C major')
  expect(v.chord!.map((t) => t.name)).toEqual(['C', 'E', 'G'])
  expect(v.footer).toBe('tones')
})

test('integrated: a chord outside the key swaps its notes in and says so', () => {
  const bar = (s: string) => ({ chords: [{ symbol: s, beats: 4 }] })
  const chart: Chart = {
    schema: 'mq.chart/1',
    id: 'test-d7',
    title: 'D7 in C',
    key: { tonic: 'C', mode: 'major' },
    meter: { num: 4, den: 4 },
    tempo: 120,
    bars: ['C', 'C', 'Am', 'F', 'D7', 'G7', 'C', 'C'].map(bar),
  }
  const tl = chartTimeline(chart)
  const atBar = (b: number) => moment(tl, b * 2000 + 100, prefs)
  expect(playView(atBar(0), 'integrated')!.callout).toBeNull()
  const v = playView(atBar(4), 'integrated')!
  expect(v.title).toBe('C major')
  expect(v.callout).toEqual({ kind: 'outside', lead: 'C major, but', changed: ['F♯'] })
  expect(names(v, 'x')).toEqual(['F♯'])
  expect(playView(atBar(4), 'simple')!.callout).toBeNull()
})

test('integrated: a key change is announced two bars ahead and shown in the last bar', () => {
  const tl = demoTimeline()
  const beat = 60000 / 168
  // chorus 2, bar 7 (Cmaj7), beat 2: the move to E♭ is 7 beats away
  const m = moment(tl, ((4 + 36 + 6) * 4 + 1.05) * beat, prefs)
  const v = playView(m, 'integrated')!
  expect(v.title).toBe('C major')
  expect(v.callout).toEqual({ kind: 'keychange', lead: 'E♭ major in 7 beats', changed: ['E♭', 'A♭', 'B♭'] })
  // bar 8, beat 2: 3 beats to go, the staff already shows E♭ major with the new notes marked
  const late = playView(moment(tl, ((4 + 36 + 7) * 4 + 1.05) * beat, prefs), 'integrated')!
  expect(late.title).toBe('E♭ major')
  expect(names(late, 'x')).toEqual(['E♭', 'A♭', 'B♭'])
  // written for alto, the same moment reads A major → C major
  const alto = playView(moment(tl, ((4 + 36 + 6) * 4 + 1.05) * beat, { ...prefs, instrument: 'alto' }), 'integrated')!
  expect(alto.title).toBe('A major')
  expect(alto.callout!.lead).toBe('C major in 7 beats')
})
