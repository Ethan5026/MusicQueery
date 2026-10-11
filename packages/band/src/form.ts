// A chart in playing order, in beats: what the band plays from. Built from the same expansion as
// `chartTimeline` (repeats, endings, jumps, then the choruses), so beat b of the form is at b × 60000 / bpm ms
// on the exact timeline (D-29) and the band and the screens can't disagree.
import type { Chart } from '@mq/model'
import { type Chord, expandChart, parseChord } from '@mq/theory'

export interface FormChord {
  symbol: string
  /** null for N.C. or a symbol that didn't parse: the band rests */
  chord: Chord | null
  /** beats from the start of the bar */
  beat: number
  beats: number
}

export interface FormBar {
  /** beats from the start of the form */
  startBeat: number
  /** beats in this bar (the meter's numerator) */
  beats: number
  chords: FormChord[]
  section?: string
  pass: number
}

export interface Form {
  bars: FormBar[]
  totalBeats: number
  /** beats per bar of the opening meter (count-in length) */
  meterNum: number
}

export function formFromChart(chart: Chart, choruses = chart.choruses ?? 1): Form {
  const once = expandChart(chart)
  const bars: FormBar[] = []
  let t = 0
  for (let p = 1; p <= choruses; p++) {
    for (const pb of once) {
      let b = 0
      const chords = pb.chords.map((s) => {
        const c = parseChord(s.symbol)
        const fc: FormChord = { symbol: s.symbol, chord: c?.kind === 'chord' ? c : null, beat: b, beats: s.beats }
        b += s.beats
        return fc
      })
      bars.push({ startBeat: t, beats: pb.meter.num, chords, ...(pb.section ? { section: pb.section } : {}), pass: choruses > 1 ? p : pb.pass })
      t += pb.meter.num
    }
  }
  return { bars, totalBeats: t, meterNum: chart.meter.num }
}

/** Index of the bar sounding at `beat` (clamped to the form). */
export function barAt(form: Form, beat: number): number {
  const bars = form.bars
  let lo = 0
  let hi = bars.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid]!.startBeat <= beat + 1e-9) lo = mid
    else hi = mid - 1
  }
  return Math.max(0, lo)
}

/** The chord sounding at `beat` of a bar, and the next chord after it (across the barline), if any. */
export function chordAt(form: Form, barIndex: number, beatInBar: number): { cur: FormChord | null; next: FormChord | null } {
  const bar = form.bars[barIndex]
  if (!bar) return { cur: null, next: null }
  let k = bar.chords.findIndex((c) => beatInBar >= c.beat - 1e-9 && beatInBar < c.beat + c.beats - 1e-9)
  if (k < 0) k = bar.chords.length - 1
  const cur = bar.chords[k] ?? null
  const next = bar.chords[k + 1] ?? form.bars[barIndex + 1]?.chords[0] ?? null
  return { cur, next }
}
