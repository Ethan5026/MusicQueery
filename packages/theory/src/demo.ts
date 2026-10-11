// The sketch's tune as a Chart v1: All the Things You Are in A♭, intro, five choruses, ending, 168 BPM.
import type { Bar, Chart } from '@mq/model'

const bar = (...symbols: string[]): Bar => ({
  chords: symbols.map((symbol) => ({ symbol, beats: 4 / symbols.length })),
})

const FORM: Bar[] = [
  ['Fm7'], ['B♭m7'], ['E♭7'], ['A♭maj7'], ['D♭maj7'], ['G7'], ['Cmaj7'], ['Cmaj7'],
  ['Cm7'], ['Fm7'], ['B♭7'], ['E♭maj7'], ['A♭maj7'], ['Am7', 'D7'], ['Gmaj7'], ['Gmaj7'],
  ['Am7'], ['D7'], ['Gmaj7'], ['Gmaj7'], ['F♯m7'], ['B7'], ['Emaj7'], ['C7♯5'],
  ['Fm7'], ['B♭m7'], ['E♭7'], ['A♭maj7'], ['D♭maj7'], ['D♭m7'], ['Cm7'], ['B°7'], ['B♭m7'], ['E♭7'], ['A♭maj7'], ['Gm7♭5', 'C7'],
].map((s) => bar(...s))

const REH: Record<number, string> = { 0: 'A1', 8: 'A2', 16: 'B', 24: 'A3' }
FORM.forEach((b, i) => {
  if (REH[i]) b.section = REH[i]
})
FORM[0]!.repeatStart = true
FORM[35]!.repeatEnd = 5

const INTRO: Bar[] = [bar('B♭m7'), bar('E♭7'), bar('A♭maj7'), bar('Gm7♭5', 'C7')]
INTRO[0]!.section = 'Intro'
const ENDING: Bar[] = [bar('B♭m7'), bar('E♭7'), bar('A♭maj7'), bar('A♭maj7')]
ENDING[0]!.section = 'Ending'

export const DEMO_CHART: Chart = {
  schema: 'mq.chart/1',
  id: 'demo-attya',
  title: 'All the Things You Are',
  composer: 'Jerome Kern',
  style: 'Medium Swing',
  key: { tonic: 'A♭', mode: 'major' },
  meter: { num: 4, den: 4 },
  tempo: 168,
  bars: [...INTRO, ...FORM, ...ENDING],
  source: { kind: 'demo' },
}

/** The sketch's hand-marked key regions for the 36-bar form (FREG). */
export const DEMO_FORM_REGIONS = [
  ...Array(5).fill('A♭'), ...Array(3).fill('C'), ...Array(5).fill('E♭'),
  ...Array(7).fill('G'), ...Array(3).fill('E'), ...Array(13).fill('A♭'),
] as string[]
