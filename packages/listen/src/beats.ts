// Online beat tracker for the mic: onset envelope → tempo by autocorrelation (log-Gaussian prior around 110 BPM,
// re-estimated every half second with inertia) → Ellis's dynamic-programming phase (librosa's tightness 100),
// with beats finalised one period behind by back-tracking from the best recent score. Pop is steady, so tempo
// changes are slow and octave jumps need a clear win.

export interface BeatTrackerOptions {
  /** onset frames per second */
  fps: number
  tightness?: number
  /** tempo prior centre (BPM) and width (octaves) */
  priorBpm?: number
  priorOctaves?: number
  minBpm?: number
  maxBpm?: number
}

export class BeatTracker {
  readonly fps: number
  private readonly tight: number
  private readonly priorBpm: number
  private readonly priorOct: number
  private readonly minLag: number
  private readonly maxLag: number
  private readonly t0: number[] = [] // frame times (s)
  private readonly env: number[] = [] // normalised onset strength
  private readonly raw: number[] = []
  private readonly score: number[] = []
  private readonly back: number[] = []
  private mean = 0
  private varc = 1
  /** current beat period in frames (0 until known) */
  period = 0
  private periodScore = 0
  private pendingPeriod = 0
  private pendingCount = 0
  private lastTempoAt = 0
  /** finalised beats (frame indices) */
  private readonly beatIdx: number[] = []
  /** finalised beats (seconds) */
  readonly beats: number[] = []

  constructor(o: BeatTrackerOptions) {
    this.fps = o.fps
    this.tight = o.tightness ?? 100
    this.priorBpm = o.priorBpm ?? 110
    this.priorOct = o.priorOctaves ?? 0.9
    this.minLag = Math.floor((60 / (o.maxBpm ?? 200)) * o.fps)
    this.maxLag = Math.ceil((60 / (o.minBpm ?? 55)) * o.fps)
  }

  get bpm(): number {
    return this.period ? (60 * this.fps) / this.period : 0
  }

  /** Adds one onset frame; returns beats (seconds) finalised by it. */
  push(t: number, value: number): number[] {
    const i = this.env.length
    this.t0.push(t)
    this.raw.push(value)
    // running mean/variance (~3 s) for normalisation; half-wave rectified after removing the local mean
    const a = 1 / (3 * this.fps)
    this.mean += a * (value - this.mean)
    this.varc += a * ((value - this.mean) ** 2 - this.varc)
    const v = Math.max(0, (value - this.mean) / Math.sqrt(this.varc + 1e-9))
    this.env.push(v)
    if (i - this.lastTempoAt >= this.fps / 2 && i > 4 * this.fps) {
      this.lastTempoAt = i
      this.updateTempo()
    }
    // DP score
    const P = this.period
    if (!P) {
      this.score.push(v)
      this.back.push(-1)
      return []
    }
    let best = -Infinity
    let arg = -1
    const lo = Math.max(0, i - Math.round(2 * P))
    const hi = i - Math.round(P / 2)
    for (let u = lo; u <= hi; u++) {
      const s = this.score[u]! - this.tight * Math.log((i - u) / P) ** 2
      if (s > best) {
        best = s
        arg = u
      }
    }
    this.score.push(arg >= 0 ? v + best : v)
    this.back.push(arg)
    return this.finalise(false)
  }

  /** Finalises what is left at the end of a stream. */
  flush(): number[] {
    return this.finalise(true)
  }

  /** Predicted next beat (seconds) after `t`, from the last finalised beat and the period; null before lock. */
  nextBeatAfter(t: number): number | null {
    const last = this.beats[this.beats.length - 1]
    if (last === undefined || !this.period) return null
    const p = this.period / this.fps
    return last + Math.ceil((t - last) / p + 1e-9) * p
  }

  private finalise(all: boolean): number[] {
    const P = this.period
    const n = this.score.length
    if (!P || n < P) return []
    // best end in the last period, then back-track
    let end = n - 1
    for (let u = Math.max(0, n - Math.round(P)); u < n; u++) if (this.score[u]! > this.score[end]!) end = u
    const chain: number[] = []
    const last = this.beatIdx[this.beatIdx.length - 1] ?? -1
    for (let u = end; u > last && u >= 0; u = this.back[u]!) chain.push(u)
    chain.reverse()
    const cutoff = all ? n : n - Math.round(P)
    const out: number[] = []
    for (const u of chain) {
      if (u > cutoff) break
      if (last >= 0 && u - (this.beatIdx[this.beatIdx.length - 1] ?? -1) < P * 0.4) continue
      this.beatIdx.push(u)
      this.beats.push(this.t0[u]!)
      out.push(this.t0[u]!)
    }
    return out
  }

  private updateTempo(): void {
    const n = this.env.length
    const W = Math.min(n, Math.round(10 * this.fps))
    const x = this.env.slice(n - W)
    const m = x.reduce((s, y) => s + y, 0) / W
    for (let k = 0; k < W; k++) x[k]! -= m
    let e0 = 0
    for (let k = 0; k < W; k++) e0 += x[k]! * x[k]!
    if (e0 <= 1e-9) return
    const ac = (L: number): number => {
      let s = 0
      for (let k = L; k < W; k++) s += x[k]! * x[k - L]!
      return s / e0
    }
    const acs = new Float64Array(this.maxLag * 2 + 2)
    for (let L = this.minLag; L <= Math.min(2 * this.maxLag, W - 1); L++) acs[L] = ac(L)
    let bestL = 0
    let best = -Infinity
    const scoreOf = (L: number): number => {
      const bpm = (60 * this.fps) / L
      const prior = Math.exp(-0.5 * (Math.log2(bpm / this.priorBpm) / this.priorOct) ** 2)
      return (acs[L]! + 0.5 * (acs[2 * L] ?? 0)) * prior
    }
    for (let L = this.minLag; L <= this.maxLag; L++) {
      const s = scoreOf(L)
      if (s > best) {
        best = s
        bestL = L
      }
    }
    if (!bestL) return
    // parabolic refinement
    const y0 = scoreOf(bestL - 1)
    const y2 = scoreOf(bestL + 1)
    const den = y0 - 2 * best + y2
    const refined = den < 0 ? bestL + (0.5 * (y0 - y2)) / den : bestL
    if (!this.period) {
      this.period = refined
      this.periodScore = best
      return
    }
    const ratio = refined / this.period
    if (Math.abs(ratio - 1) < 0.06) {
      // same tempo: follow slowly
      this.period += 0.2 * (refined - this.period)
      this.periodScore = best
      this.pendingCount = 0
      return
    }
    // a different tempo must win clearly on 3 estimates in a row (1.5 s)
    const current = scoreOf(Math.round(this.period))
    if (best > current * 1.15 && Math.abs(refined / (this.pendingPeriod || 1) - 1) < 0.06) this.pendingCount++
    else {
      this.pendingPeriod = refined
      this.pendingCount = best > current * 1.15 ? 1 : 0
    }
    if (this.pendingCount >= 3) {
      this.period = refined
      this.periodScore = best
      this.pendingCount = 0
    }
  }
}

/** Beat F-measure (±70 ms), the usual MIREX setting; beats before `fromMs` in the reference are ignored. */
export function beatF(ref: number[], est: number[], tol = 70, fromMs = 5000): number {
  const r = ref.filter((t) => t >= fromMs)
  const e = est.filter((t) => t >= fromMs - tol)
  if (!r.length || !e.length) return 0
  let hits = 0
  let j = 0
  const used = new Uint8Array(e.length)
  for (const t of r) {
    while (j < e.length && e[j]! < t - tol) j++
    for (let k = j; k < e.length && e[k]! <= t + tol; k++)
      if (!used[k]) {
        used[k] = 1
        hits++
        break
      }
  }
  const p = hits / e.length
  const rc = hits / r.length
  return p + rc > 0 ? (2 * p * rc) / (p + rc) : 0
}
