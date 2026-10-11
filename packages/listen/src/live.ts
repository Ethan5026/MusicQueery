// The streaming decoder behind "Listening live" (M7, D-04): mic samples in, chords out, in stream seconds (the
// host maps them to track time). Stages as in offline.ts, made causal:
//  - the beat tracker finalises beats about one period late; a beat's chroma is complete once the next beat is;
//  - each complete beat's evidence is averaged with its earlier repeats (chorus consensus, past only) and
//    filtered forward; what is shown *now* is that filter carried over the last beat's worth of frames, with
//    a little hysteresis so the chord doesn't flicker;
//  - beats more than `lag` beats old are settled by Viterbi over a short window, for the stored timeline;
//  - Predicted: what followed the earlier repeats of the last bars is what is expected next.
// `finish()` re-decodes the whole listen with two-way consensus for the timeline that gets saved.
import { BeatTracker } from './beats'
import {
  type BeatFeature,
  DEFAULT_EMISSION,
  DEFAULT_TRANSITION,
  type EmissionParams,
  NC_STATE,
  STATES,
  type TransitionParams,
  changePrior,
  emissions,
  stateText,
  viterbi,
} from './chords'
import { type ChromaFrame, Frontend } from './frontend'
import { keyWeights } from './keys'
import { DEFAULT_REPEAT, beatVectors, consensus, findRepeats } from './repeats'

export interface LiveChord {
  /** stream seconds */
  start: number
  end: number
  symbol: string
  confidence: number
}

export interface LiveNow {
  /** stream seconds of the newest frame */
  t: number
  /** what to show now (null before anything is heard) */
  symbol: string | null
  confidence: number
  /** stream seconds when the shown chord started */
  since: number
  bpm: number
  /** level of the last frame, dBFS */
  db: number
  /** chords expected next from the song's earlier repeats (empty until a repeat is found) */
  predicted: LiveChord[]
}

export interface LiveOptions {
  sampleRate: number
  emission?: Partial<EmissionParams>
  transition?: Partial<TransitionParams>
  /** beats behind the newest complete beat that are settled for the stored timeline */
  lag?: number
  /** beats of look-ahead in `predicted` */
  horizon?: number
  /** expected state per stream time from an earlier timeline of the same track (e.g. a previous listen) */
  prior?: (t: number) => { state: number; weight: number } | null
  /** seconds of recent frames behind the shown chord */
  displaySpan?: number
  /** frames a new chord must lead before it is shown */
  hold?: number
  /** log-likelihood bonus for the Predicted chord (× its confidence) when deciding what to show */
  predictBias?: number
}

const SELF = 1.5

export class LiveDecoder {
  readonly fe: Frontend
  readonly bt: BeatTracker
  private readonly ep: EmissionParams
  private readonly tp: TransitionParams
  private readonly lag: number
  private readonly horizon: number
  private readonly prior: LiveOptions['prior']
  private readonly displaySpan: number
  private readonly hold: number
  private readonly predictBias: number
  private readonly frames: ChromaFrame[] = []
  /** complete beats */
  readonly beatTimes: number[] = []
  private readonly feats: BeatFeature[] = []
  private readonly ll: Float32Array[] = []
  /** ll averaged with earlier repeats */
  private readonly llc: Float32Array[] = []
  private readonly vecs: Float32Array[] = []
  /** per lag: running diagonal sums over the last `window` beats */
  private diag: Float64Array = new Float64Array(0)
  private alpha: Float64Array
  private readonly keyChroma = new Float64Array(12)
  private changeLog: Float32Array
  /** settled state per complete beat */
  readonly settled: number[] = []
  private readonly settledConf: number[] = []
  private readonly filteredConf: number[] = []
  private shown = -1
  private shownSince = 0
  private challenger = -1
  private challengerCount = 0
  private lastDb = -120
  private lastMatches: { j: number; sim: number }[] = []

  constructor(o: LiveOptions) {
    this.fe = new Frontend({ sampleRate: o.sampleRate })
    this.bt = new BeatTracker({ fps: this.fe.sr / 128 })
    this.ep = { ...DEFAULT_EMISSION, ...o.emission }
    this.tp = { ...DEFAULT_TRANSITION, ...o.transition }
    this.lag = o.lag ?? 4
    this.horizon = o.horizon ?? 16
    this.prior = o.prior
    this.displaySpan = o.displaySpan ?? 0.2
    this.hold = o.hold ?? 1
    this.predictBias = o.predictBias ?? 8
    this.alpha = new Float64Array(STATES.length).fill(-Math.log(STATES.length))
    this.changeLog = changePrior(null, this.tp)
  }

  get bpm(): number {
    return this.bt.bpm
  }

  push(samples: ArrayLike<number>): void {
    this.fe.push(
      samples,
      (f) => {
        this.frames.push(f)
        this.lastDb = f.db
        this.updateShown()
      },
      (o) => {
        const done = this.bt.push(o.t, o.value)
        for (const b of done) this.addBeatBoundary(b)
      },
    )
  }

  /** What to show now. */
  now(): LiveNow {
    const t = this.frames[this.frames.length - 1]?.t ?? 0
    return {
      t,
      symbol: this.shown >= 0 ? stateText(this.shown) : null,
      confidence: this.shownConf,
      since: this.shownSince,
      bpm: this.bpm,
      db: this.lastDb,
      predicted: this.predict(),
    }
  }

  /** Settled chords so far (stream seconds), runs merged. */
  settledChords(): LiveChord[] {
    return runs(this.settled, this.settledConf, this.beatTimes)
  }

  /** Re-decodes everything heard with two-way chorus consensus: the chords to store. */
  finish(): { chords: LiveChord[]; beats: number[] } {
    for (const b of this.bt.flush()) this.addBeatBoundary(b)
    if (this.feats.length === 0) return { chords: [], beats: [...this.beatTimes] }
    const ll = consensus(this.ll, findRepeats(this.vecs, { window: DEFAULT_REPEAT.window, threshold: DEFAULT_REPEAT.threshold }), SELF)
    const prior = changePrior(keyWeights(this.keyChroma), this.tp)
    const path = viterbi(ll, ll.map(() => prior), this.tp)
    const conf = path.map((s, i) => softmaxAt(ll[i]!, s))
    return { chords: runs(path, conf, this.beatTimes), beats: [...this.beatTimes] }
  }

  // ---------------------------------------------------------------- beats

  private pendingBoundary: number | null = null

  private addBeatBoundary(t: number): void {
    const start = this.pendingBoundary
    this.pendingBoundary = t
    if (start === null) return
    // the beat [start, t) is complete
    const f = this.beatFeature(start, t)
    if (this.beatTimes.length === 0) this.beatTimes.push(start)
    this.beatTimes.push(t)
    const i = this.feats.length
    this.feats.push(f)
    for (let p = 0; p < 12; p++) this.keyChroma[p]! += f.treble[p]!
    if (i % 8 === 0) this.changeLog = changePrior(keyWeights(this.keyChroma), this.tp)
    const ll = emissions(f, this.ep)
    if (this.prior) {
      const pr = this.prior((start + t) / 2)
      if (pr) ll[pr.state]! += pr.weight
    }
    this.ll.push(ll)
    this.vecs.push(beatVectors([f])[0]!)
    const matches = this.matchPast(i)
    this.lastMatches = matches
    let llc = ll
    if (matches.length) {
      llc = new Float32Array(ll.length)
      let w = SELF
      for (let s = 0; s < ll.length; s++) llc[s] = ll[s]! * SELF
      for (const { j, sim } of matches) {
        const o = this.ll[j]!
        for (let s = 0; s < ll.length; s++) llc[s]! += o[s]! * sim
        w += sim
      }
      for (let s = 0; s < ll.length; s++) llc[s]! /= w
    }
    this.llc.push(llc)
    this.alpha = forward(this.alpha, llc, this.changeLog, this.tp)
    this.filteredConf.push(Math.exp(max(this.alpha)))
    this.settle(false)
  }

  private beatFeature(a: number, b: number): BeatFeature {
    const bass = new Float32Array(12)
    const treble = new Float32Array(12)
    let db = -120
    let n = 0
    for (let k = this.frames.length - 1; k >= 0; k--) {
      const f = this.frames[k]!
      if (f.t >= b) continue
      if (f.t < a) break
      for (let p = 0; p < 12; p++) {
        bass[p]! += f.bass[p]!
        treble[p]! += f.treble[p]!
      }
      db = Math.max(db, f.db)
      n++
    }
    if (!n) {
      const f = this.frames[this.frames.length - 1]
      if (f) {
        bass.set(f.bass)
        treble.set(f.treble)
        db = f.db
      }
    }
    // frames older than a few seconds are no longer needed
    if (this.frames.length > 400) this.frames.splice(0, this.frames.length - 300)
    return { bass, treble, db }
  }

  /** Earlier beats j whose last `window` beats match the last `window` beats up to i (causal diagonals). */
  private matchPast(i: number): { j: number; sim: number }[] {
    const { window: W, minLag, threshold } = DEFAULT_REPEAT
    const W2 = Math.round(W * 0.75)
    if (this.diag.length < i + 1) {
      const d = new Float64Array(Math.max(64, (i + 1) * 2))
      d.set(this.diag)
      this.diag = d
    }
    const v = this.vecs
    const out: { j: number; sim: number }[] = []
    for (let lag = minLag; lag <= i; lag++) {
      // add the newest diagonal element, drop the one that left the window
      let s = this.diag[lag]! + dot(v[i]!, v[i - lag]!)
      const old = i - W2
      if (old - lag >= 0) s -= dot(v[old]!, v[old - lag]!)
      this.diag[lag] = s
      const n = Math.min(W2, i - lag + 1)
      if (n >= W2 / 2 && s / n >= threshold) out.push({ j: i - lag, sim: s / n })
    }
    return out
  }

  /** Settles beats older than `lag` by Viterbi over a short window starting at the last settled beat. */
  private settle(all: boolean): void {
    const n = this.llc.length
    const upto = all ? n : n - this.lag
    if (upto <= this.settled.length) return
    const from = Math.max(0, this.settled.length - 1)
    const ll = this.llc.slice(from, n)
    if (this.settled.length > 0) {
      // pin the window's first beat to its settled state
      const pin = new Float32Array(STATES.length).fill(-1e6)
      pin[this.settled[this.settled.length - 1]!] = 0
      ll[0] = pin
    }
    const path = viterbi(ll, ll.map(() => this.changeLog), this.tp)
    for (let i = this.settled.length; i < upto; i++) {
      this.settled.push(path[i - from]!)
      this.settledConf.push(this.filteredConf[i] ?? 0.5)
    }
  }

  // ---------------------------------------------------------------- now

  private shownConf = 0
  private cachedPred: LiveChord[] = []

  private updateShown(): void {
    const f = this.frames[this.frames.length - 1]!
    const P = this.bt.period ? this.bt.period / this.bt.fps : 0.5
    // the last beat's worth of frames (at least ~0.35 s)
    const span = this.displaySpan
    const bass = new Float32Array(12)
    const treble = new Float32Array(12)
    let db = -120
    for (let k = this.frames.length - 1; k >= 0 && this.frames[k]!.t > f.t - span; k--) {
      const g = this.frames[k]!
      for (let p = 0; p < 12; p++) {
        bass[p]! += g.bass[p]!
        treble[p]! += g.treble[p]!
      }
      db = Math.max(db, g.db)
    }
    const ll = emissions({ bass, treble, db }, this.ep)
    if (this.predictBias > 0 && this.frames.length % 2 === 0) this.cachedPred = this.predict()
    if (this.predictBias > 0) {
      // the frame is centred ~n/2 samples back; the music now is what was predicted for the newest sample
      const now = f.t + this.fe.n / 2 / this.fe.sr
      const c = this.cachedPred.find((p) => p.start <= now && p.end > now)
      const s = c ? STATES.findIndex((_, k) => stateText(k) === c.symbol) : -1
      if (c && s >= 0) ll[s]! += this.predictBias * c.confidence
    }
    // carry the filter from the last complete beat over the beats since
    const steps = Math.max(1, Math.round((f.t - (this.beatTimes[this.beatTimes.length - 1] ?? f.t)) / P))
    let a = this.alpha
    for (let k = 0; k < steps; k++) a = predictStep(a, this.changeLog, this.tp)
    const post = new Float64Array(STATES.length)
    let m = -Infinity
    for (let s = 0; s < post.length; s++) {
      post[s] = a[s]! + ll[s]!
      m = Math.max(m, post[s]!)
    }
    let sum = 0
    for (let s = 0; s < post.length; s++) sum += Math.exp(post[s]! - m)
    let best = 0
    for (let s = 1; s < post.length; s++) if (post[s]! > post[best]!) best = s
    const pBest = Math.exp(post[best]! - m) / sum
    if (this.shown < 0) {
      if (best !== NC_STATE || db < this.ep.silenceDb) this.setShown(best, f.t)
    } else if (best !== this.shown) {
      // hysteresis: a challenger must lead for 2 frames (~90 ms), or clearly at once
      if (best === this.challenger) this.challengerCount++
      else {
        this.challenger = best
        this.challengerCount = 1
      }
      if (this.challengerCount >= this.hold || pBest > 0.8) this.setShown(best, f.t)
    } else this.challengerCount = 0
    this.shownConf = Math.exp(post[this.shown]! - m) / sum
  }

  private setShown(s: number, t: number): void {
    if (s !== this.shown) this.shownSince = t
    this.shown = s
    this.challenger = -1
    this.challengerCount = 0
  }

  // ---------------------------------------------------------------- predicted

  private predict(): LiveChord[] {
    const i = this.ll.length - 1
    const matches = this.lastMatches
    if (i < 0 || !matches.length || !this.bt.period) return []
    const P = this.bt.period / this.bt.fps
    const t0 = this.beatTimes[this.beatTimes.length - 1]!
    const now = this.frames[this.frames.length - 1]?.t ?? t0
    const states: number[] = []
    const confs: number[] = []
    for (let k = 1; k <= this.horizon + 2; k++) {
      const votes = new Map<number, number>()
      let total = 0
      for (const { j, sim } of matches) {
        const src = j + k
        if (src >= i) continue
        const s = this.settled[src] ?? argmax(this.ll[src]!)
        votes.set(s, (votes.get(s) ?? 0) + sim)
        total += sim
      }
      if (total === 0) break
      let bestS = -1
      let bestV = 0
      for (const [s, v] of votes)
        if (v > bestV) {
          bestV = v
          bestS = s
        }
      states.push(bestS)
      confs.push(bestV / total)
    }
    // beats after the last complete one, on the tracker's grid; keep those still ahead
    const out: LiveChord[] = []
    const times = states.map((_, k) => t0 + (k + 1) * P)
    for (const c of runs(states, confs, [...times, t0 + (states.length + 1) * P])) if (c.end > now) out.push(c)
    return out.slice(0, 8)
  }
}

function forward(alpha: Float64Array, ll: Float32Array, change: Float32Array, tp: TransitionParams): Float64Array {
  const a = predictStep(alpha, change, tp)
  let m = -Infinity
  for (let s = 0; s < a.length; s++) {
    a[s]! += ll[s]!
    m = Math.max(m, a[s]!)
  }
  let sum = 0
  for (let s = 0; s < a.length; s++) sum += Math.exp(a[s]! - m)
  const z = m + Math.log(sum)
  for (let s = 0; s < a.length; s++) a[s]! -= z
  return a
}

/** One beat of the transition model in the log domain: stay, or move with the change prior. */
function predictStep(alpha: Float64Array, change: Float32Array, tp: TransitionParams): Float64Array {
  const out = new Float64Array(alpha.length)
  const m = max(alpha)
  let total = 0
  for (let s = 0; s < alpha.length; s++) total += Math.exp(alpha[s]! - m)
  const logTotal = m + Math.log(total)
  const ls = Math.log(tp.stay)
  const lm = Math.log(1 - tp.stay)
  for (let s = 0; s < alpha.length; s++) out[s] = logAdd(alpha[s]! + ls, logTotal + lm + change[s]!)
  return out
}

const logAdd = (a: number, b: number): number => (a > b ? a + Math.log1p(Math.exp(b - a)) : b + Math.log1p(Math.exp(a - b)))
const max = (a: ArrayLike<number>): number => {
  let m = -Infinity
  for (let i = 0; i < a.length; i++) m = Math.max(m, a[i]!)
  return m
}
const argmax = (a: ArrayLike<number>): number => {
  let b = 0
  for (let i = 1; i < a.length; i++) if (a[i]! > a[b]!) b = i
  return b
}
const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

function softmaxAt(ll: Float32Array, s: number): number {
  const m = max(ll)
  let sum = 0
  for (let i = 0; i < ll.length; i++) sum += Math.exp(ll[i]! - m)
  return Math.exp(ll[s]! - m) / sum
}

/** Per-beat states → chords (runs merged), times from `beats` (beat k spans beats[k]..beats[k+1]). */
function runs(states: number[], conf: number[], beats: number[]): LiveChord[] {
  const out: LiveChord[] = []
  let n = 0
  for (let k = 0; k < states.length && k + 1 < beats.length; k++) {
    const symbol = stateText(states[k]!)
    const last = out[out.length - 1]
    if (last && last.symbol === symbol) {
      last.end = beats[k + 1]!
      last.confidence += conf[k] ?? 0
      n++
    } else {
      if (last) last.confidence /= n
      out.push({ start: beats[k]!, end: beats[k + 1]!, symbol, confidence: conf[k] ?? 0 })
      n = 1
    }
  }
  const last = out[out.length - 1]
  if (last) last.confidence /= n
  for (const c of out) c.confidence = Math.round(Math.min(1, Math.max(0, c.confidence)) * 1000) / 1000
  return out
}
