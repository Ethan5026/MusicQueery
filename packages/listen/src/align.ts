// Linking a chart to a recording (M7): Jump Alignment (McVicar et al. 2011, as D-40 used for Chordonomicon) of an
// iReal chart's playing order onto a timeline's beats, by the chord labels the timeline already has (analysed or
// live), so it runs on the phone. A dynamic programme over recording beats picks, per beat, a chart beat or a "free"
// state (an intro, solo or outro the chart doesn't have):
//   next chart beat 0 · hold or skip a beat −1.5 (tempo slips) · bar line → any bar line −3 (repeats, sections in
//   another order, bars the chart adds or drops: pop charts rarely match the record's form, D-36) · end of the form
//   → its top −1 (another chorus) · free −0.4 a beat, in and out −3 at bar lines.
// Every transposition and tempo ratio (½, 1, 2: the beat tracker can lock at double time) is tried; the best path
// wins. Where it matched, the chart's chords and rehearsal marks replace the timeline's, keeping its beat timing.
import type { Chart, Timeline } from '@mq/model'
import { type Chord, effectiveChords, expandChart, finishAnalysis, formatQuality, parseChord, pc, transposeChord } from '@mq/theory'
import { STATES, stateOfSymbol } from './chords'

export interface AlignOptions {
  /** least share of matched beats whose roots agree before the chart is trusted */
  minAgreement?: number
  /** most jumps per matched bar before the chart is distrusted: on the truth set the right charts made 0.03–0.13,
   *  another song's chart 0.17–0.48 (it fits a pop song only by rearranging its bars) */
  maxJumpRate?: number
}

export interface AlignResult {
  /** the timeline with the chart's chords where it matched (null when the chart was not trusted) */
  timeline: Timeline | null
  /** semitones the chart was moved by to fit the recording */
  semis: number
  /** chart beats per recording beat */
  ratio: number
  /** share of recording beats matched to the chart */
  matched: number
  /** share of matched beats where the chart's root agrees with the timeline's */
  agreement: number
  /** jumps away from the chart's playing order per matched bar (a right chart follows its form) */
  jumpRate: number
}

interface ChartBeat {
  symbol: string
  state: number
  barStart: boolean
  barEnd: boolean
  section?: string
  barNumber: number
}

/** The chart once through, a beat at a time. */
function chartBeats(chart: Chart): ChartBeat[] {
  const out: ChartBeat[] = []
  let lastSection: string | undefined
  for (const pb of expandChart(chart)) {
    const n = pb.meter.num
    let acc = 0
    const slots = pb.chords.map((c) => {
      const s = { from: acc, symbol: c.symbol }
      acc += c.beats
      return s
    })
    for (let k = 0; k < n; k++) {
      let sym = slots[0]!.symbol
      for (const s of slots) if (s.from <= k + 1e-6) sym = s.symbol
      const newSection = k === 0 && pb.section && pb.section !== lastSection ? pb.section : undefined
      if (k === 0) lastSection = pb.section
      out.push({
        symbol: sym,
        state: stateOfSymbol(sym),
        barStart: k === 0,
        barEnd: k === n - 1,
        ...(newSection ? { section: newSection } : {}),
        barNumber: pb.number,
      })
    }
  }
  return out
}

/** sim[chartState][heardState]: same root and third 1, same root 0.4, heard root a chart tone 0.05, else −0.6. */
const SIM: Float32Array[] = STATES.map((c) =>
  Float32Array.from(STATES, (h) => {
    if (h.root < 0) return 0
    if (c.root < 0) return -0.2
    if (c.root === h.root) return (c.q === 'min' || c.q === 'min7') === (h.q === 'min' || h.q === 'min7') ? 1 : 0.4
    return c.tones.includes(h.root) ? 0.05 : -0.6
  }),
)

const transposeState = (s: number, semis: number): number => {
  const c = STATES[s]!
  if (c.root < 0) return s
  return s - c.root + ((c.root + semis) % 12)
}

function resample(beats: ChartBeat[], ratio: number): ChartBeat[] {
  if (ratio === 1) return beats
  if (ratio === 2) return beats.flatMap((b) => [{ ...b, barEnd: false }, { ...b, barStart: false, section: undefined } as ChartBeat])
  // ½: one recording beat covers two chart beats
  const out: ChartBeat[] = []
  for (let i = 0; i < beats.length; i += 2) {
    const a = beats[i]!
    const b = beats[i + 1]
    out.push({ ...a, barStart: a.barStart || !!b?.barStart, barEnd: a.barEnd || !!b?.barEnd, ...(a.section || b?.section ? { section: a.section ?? b?.section } : {}) })
  }
  return out
}

const STAY = -1.5
const JUMP = -3
const WRAP = -1
const FREE = -0.4

/** Forward pass (and the path when `keep`): returns the best total score and, if kept, the chart index per beat (−1 free). */
function run(cb: ChartBeat[], heard: number[], weight: number[], semis: number, keep: boolean): { score: number; path: number[] } {
  const M = cb.length
  const T = heard.length
  const F = M
  const cs = cb.map((b) => transposeState(b.state, semis))
  let delta = new Float64Array(M + 1)
  for (let j = 0; j < M; j++) delta[j] = (cb[j]!.barStart ? 0 : -6) + SIM[cs[j]!]![heard[0]!]! * weight[0]!
  delta[F] = 0
  const back: Int32Array[] = []
  for (let t = 1; t < T; t++) {
    let bestEnd = -Infinity
    let bestEndK = -1
    for (let k = 0; k < M; k++)
      if (cb[k]!.barEnd && delta[k]! > bestEnd) {
        bestEnd = delta[k]!
        bestEndK = k
      }
    const next = new Float64Array(M + 1)
    const bp = keep ? new Int32Array(M + 1) : null
    const h = heard[t]!
    const w = weight[t]!
    for (let j = 0; j < M; j++) {
      let best = delta[j]! + STAY
      let arg = j
      if (j > 0 && delta[j - 1]! > best) {
        best = delta[j - 1]!
        arg = j - 1
      }
      if (j > 1 && delta[j - 2]! + STAY > best) {
        best = delta[j - 2]! + STAY
        arg = j - 2
      }
      if (cb[j]!.barStart) {
        if (bestEnd + JUMP > best) {
          best = bestEnd + JUMP
          arg = bestEndK
        }
        if (delta[F]! + JUMP > best) {
          best = delta[F]! + JUMP
          arg = F
        }
        if (j === 0 && delta[M - 1]! + WRAP > best) {
          best = delta[M - 1]! + WRAP
          arg = M - 1
        }
      }
      next[j] = best + SIM[cs[j]!]![h]! * w
      if (bp) bp[j] = arg
    }
    if (delta[F]! + FREE >= bestEnd + JUMP) {
      next[F] = delta[F]! + FREE
      if (bp) bp[F] = F
    } else {
      next[F] = bestEnd + JUMP
      if (bp) bp[F] = bestEndK
    }
    if (bp) back.push(bp)
    delta = next
  }
  let end = 0
  for (let j = 1; j <= M; j++) if (delta[j]! > delta[end]!) end = j
  const score = delta[end]!
  if (!keep) return { score, path: [] }
  const path = new Array<number>(T)
  path[T - 1] = end
  for (let t = T - 1; t > 0; t--) path[t - 1] = back[t - 1]![path[t]!]!
  return { score, path: path.map((j) => (j === F ? -1 : j)) }
}

export function alignChart(chart: Chart, tl: Timeline, o: AlignOptions = {}): AlignResult {
  const beats = tl.beats
  const none: AlignResult = { timeline: null, semis: 0, ratio: 1, matched: 0, agreement: 0, jumpRate: 0 }
  if (beats.length < 16) return none
  const spans = effectiveChords(tl)
  const heard: number[] = []
  const weight: number[] = []
  let j = 0
  for (let t = 0; t < beats.length; t++) {
    const mid = t + 1 < beats.length ? (beats[t]! + beats[t + 1]!) / 2 : beats[t]! + 1
    while (j < spans.length && spans[j]!.endMs <= mid) j++
    const c = spans[j] && spans[j]!.startMs <= mid ? spans[j]! : null
    heard.push(c ? stateOfSymbol(c.symbol) : 0)
    weight.push(0.5 + 0.5 * (c?.confidence ?? 0.7))
  }
  const once = chartBeats(chart)
  let best = { score: -Infinity, semis: 0, ratio: 1 }
  for (const ratio of [1, 2, 0.5])
    for (let semis = 0; semis < 12; semis++) {
      const { score } = run(resample(once, ratio), heard, weight, semis, false)
      if (score > best.score) best = { score, semis, ratio }
    }
  const cb = resample(once, best.ratio)
  const { path } = run(cb, heard, weight, best.semis, true)
  let matched = 0
  let agree = 0
  let jumps = 0
  for (let t = 0; t < path.length; t++) {
    const k = path[t]!
    if (k < 0) continue
    const p = t > 0 ? path[t - 1]! : -2
    if (p >= 0 && k !== p + 1 && k !== p && k !== p + 2 && !(k === 0 && p === cb.length - 1)) jumps++
    matched++
    const c = STATES[transposeState(cb[k]!.state, best.semis)]!
    if (STATES[heard[t]!]!.root === c.root) agree++
  }
  const barBeats = cb.filter((b) => b.barStart).length ? cb.length / cb.filter((b) => b.barStart).length : 4
  const result = {
    semis: best.semis,
    ratio: best.ratio,
    matched: matched / path.length,
    agreement: matched ? agree / matched : 0,
    jumpRate: matched ? jumps / (matched / barBeats) : 0,
  }
    if (result.agreement < (o.minAgreement ?? 0.5) || result.jumpRate > (o.maxJumpRate ?? 0.18) || result.matched < 0.25)
    return { ...result, timeline: null }

  // chords: the chart's where matched (moved into the recording's key), the timeline's elsewhere
  const iv = { steps: Math.round((best.semis * 7) / 12) % 7, semis: best.semis }
  const raw: { startMs: number; endMs: number; symbol: string; confidence?: number }[] = []
  for (let t = 0; t + 1 < beats.length; t++) {
    const k = path[t]!
    let symbol: string
    let confidence: number | undefined
    if (k >= 0) {
      const c = parseChord(cb[k]!.symbol)
      symbol = c && c.kind === 'chord' ? formatTransposed(c, iv) : 'N.C.'
      confidence = 0.9
    } else {
      const mid = (beats[t]! + beats[t + 1]!) / 2
      const s = spans.find((x) => x.startMs <= mid && x.endMs > mid)
      symbol = s?.symbol ?? 'N.C.'
      confidence = s?.confidence
    }
    raw.push({ startMs: beats[t]!, endMs: beats[t + 1]!, symbol, ...(confidence !== undefined ? { confidence } : {}) })
  }
  const fin = finishAnalysis(raw, beats)
  // bar lines and rehearsal marks from the chart where it matched; the timeline's own bars in free stretches
  const bars: Timeline['bars'] = []
  for (let t = 0; t < path.length; t++) {
    const k = path[t]!
    if (k >= 0 && cb[k]!.barStart && (t === 0 || path[t - 1] !== k))
      bars.push({ startMs: beats[t]!, number: cb[k]!.barNumber, ...(cb[k]!.section ? { section: cb[k]!.section } : {}), chartBar: 0 })
    else if (k < 0) {
      const own = tl.bars.find((b) => Math.abs(b.startMs - beats[t]!) < 1)
      if (own) bars.push({ startMs: own.startMs, number: own.number })
    }
  }
  for (const b of bars) delete (b as { chartBar?: number }).chartBar
  return {
    ...result,
    timeline: { ...tl, chords: fin.chords, keys: fin.keys, bars, chartId: chart.id },
  }
}

const NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

/** The chart chord moved by `iv`, roots in neutral names (finishAnalysis respells them in the detected key). */
function formatTransposed(c: Chord, iv: { steps: number; semis: number }): string {
  const t = transposeChord(c, iv)
  return NAMES[pc(t.root)]! + formatQuality(t) + (t.bass ? `/${NAMES[pc(t.bass)]!}` : '')
}
