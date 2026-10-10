// Drift probe analysis (pure). The mic hears a metronome track; every click lies on a grid
// k·P + c in track time. For each click we read the clock's predicted position at the moment
// the click was heard; its phase on the grid should stay constant. Drift is the phase change
// since calibration, so the unknown click offset c and fixed latencies cancel out.

export interface ClockAt {
  trackId: string | null
  playing: boolean
  /** Raw clock position (ms) at the onset time, without the device offset. */
  posMs: number
}

export interface Onset {
  /** performance.now() time the click reached the mic. */
  at: number
  level: number
}

export type EpisodeKind = 'seek' | 'track' | 'play' | 'pause' | 'drift'

export interface Episode {
  kind: EpisodeKind
  /** Conservative start: last in-tolerance click, or one period before the first bad one after a silence. */
  startAt: number
  firstBadAt: number
  endAt: number
  /** endAt − startAt: upper bound on re-lock time. */
  relockMs: number
  /** endAt − firstBadAt: lower bound. */
  relockMinMs: number
}

export interface DriftPoint {
  at: number
  driftMs: number
}

export interface Summary {
  periodMs: number
  calibrated: boolean
  calibrationPhaseMs: number | null
  measuredFromAt: number | null
  measuredForMs: number
  points: number
  medianAbsMs: number | null
  p95AbsMs: number | null
  maxAbsMs: number | null
  meanMs: number | null
  slopeMsPerMin: number | null
  onsets: number
  rejected: number
  unclocked: number
  episodes: Episode[]
  fittedPeriodMs: number | null
  periodPpm: number | null
}

export interface AnalyzerOptions {
  periodMs: number
  /** Calibration length for the first track. */
  calibrateMs?: number
  /** Minimum clicks to calibrate a track. */
  calibrateMin?: number
  toleranceMs?: number
  /** Consecutive good clicks that count as re-locked. */
  relockRun?: number
}

export function wrap(x: number, period: number): number {
  const h = period / 2
  return ((((x + h) % period) + period) % period) - h
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (i - lo)
}

export function circularMedian(phases: number[], period: number): number {
  let s = 0
  let c = 0
  for (const p of phases) {
    s += Math.sin((2 * Math.PI * p) / period)
    c += Math.cos((2 * Math.PI * p) / period)
  }
  const centre = (Math.atan2(s, c) / (2 * Math.PI)) * period
  const rel = phases.map((p) => wrap(p - centre, period)).sort((a, b) => a - b)
  return wrap(quantile(rel, 0.5) + centre, period)
}

/** Least-squares slope of y on x. */
export function slope(xs: number[], ys: number[]): number {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += ((xs[i] as number) - mx) * ((ys[i] as number) - my)
    den += ((xs[i] as number) - mx) ** 2
  }
  return den === 0 ? 0 : num / den
}

interface OpenEpisode {
  startAt: number
  firstBadAt: number
  kinds: Set<EpisodeKind>
  points: DriftPoint[]
  goodRun: DriftPoint[]
}

export class DriftAnalyzer {
  readonly periodMs: number
  readonly points: DriftPoint[] = []
  readonly episodes: Episode[] = []
  private readonly calibrateMs: number
  private readonly calibrateMin: number
  private readonly tol: number
  private readonly relockRun: number

  private cal = new Map<string, number>()
  private pending = new Map<string, { at: number; phase: number }[]>()
  private accepted: number[] = []
  private lastHeardAt: number | undefined
  private onsets = 0
  private rejected = 0
  private unclocked = 0
  private lastGoodAt: number | null = null
  private open: OpenEpisode | null = null
  private firstCalAt: number | null = null

  constructor(o: AnalyzerOptions) {
    this.periodMs = o.periodMs
    this.calibrateMs = o.calibrateMs ?? 20_000
    this.calibrateMin = o.calibrateMin ?? 8
    this.tol = o.toleranceMs ?? 150
    this.relockRun = o.relockRun ?? 3
  }

  /** Clock jumps classify the episode they fall in. */
  addJump(kind: string, at: number): void {
    const k = (['seek', 'track', 'play', 'pause'] as const).find((x) => x === kind)
    if (!k) return
    if (this.open) {
      this.open.kinds.add(k)
      // A new track needs its own calibration, so the episode ends when the clock sees the change.
      if (k === 'track') this.close(at)
    }
  }

  /** Returns the drift for this click, or null while rejected, unclocked or calibrating. */
  addOnset(o: Onset, clock: ClockAt): number | null {
    this.onsets++
    const P = this.periodMs
    // Keep clicks that sit on a whole number of periods from the last kept click, or from the
    // last heard one (so a seek or skip onto a new grid is picked up on its second click).
    const fits = (prev: number | undefined) => {
      if (prev === undefined || o.at - prev >= 3000) return true
      const k = Math.round((o.at - prev) / P)
      return k >= 1 && Math.abs(o.at - prev - k * P) <= 0.12 * P
    }
    const heard = this.lastHeardAt
    this.lastHeardAt = o.at
    const onOldGrid = fits(this.accepted.at(-1))
    if (!onOldGrid && !fits(heard)) {
      this.rejected++
      return null
    }
    this.accepted.push(o.at)
    // On a new grid the previous (rejected) click was real, and is when the change became audible.
    const audibleAt = !onOldGrid && heard !== undefined ? heard : o.at

    if (!clock.playing || clock.trackId === null) {
      this.unclocked++
      this.bad(audibleAt, null)
      return null
    }
    const phase = wrap(clock.posMs, P)
    const cal = this.cal.get(clock.trackId)
    if (cal === undefined) {
      this.calibrate(clock.trackId, o.at, phase)
      return null
    }
    const d = wrap(phase - cal, P)
    const pt = { at: o.at, driftMs: d }
    if (Math.abs(d) <= this.tol) this.good(pt)
    else this.bad(audibleAt, pt)
    return d
  }

  private calibrate(trackId: string, at: number, phase: number): void {
    const list = this.pending.get(trackId) ?? []
    list.push({ at, phase })
    this.pending.set(trackId, list)
    const first = this.cal.size === 0
    const spanOk = !first || at - (list[0] as { at: number }).at >= this.calibrateMs
    if (list.length >= this.calibrateMin && spanOk) {
      this.cal.set(
        trackId,
        circularMedian(
          list.map((x) => x.phase),
          this.periodMs,
        ),
      )
      this.pending.delete(trackId)
      if (first) this.firstCalAt = at
      this.lastGoodAt = at
    }
  }

  private good(pt: DriftPoint): void {
    if (!this.open) {
      this.points.push(pt)
      this.lastGoodAt = pt.at
      return
    }
    this.open.goodRun.push(pt)
    if (this.open.goodRun.length >= this.relockRun) this.close((this.open.goodRun[0] as DriftPoint).at)
  }

  private bad(at: number, pt: DriftPoint | null): void {
    if (this.firstCalAt === null) return
    if (!this.open) {
      const last = this.lastGoodAt ?? at
      this.open = {
        startAt: Math.max(last, at - this.periodMs),
        firstBadAt: at,
        kinds: new Set(),
        points: [],
        goodRun: [],
      }
    }
    // A bad click breaks the good run; its clicks stay with the episode.
    this.open.points.push(...this.open.goodRun)
    this.open.goodRun = []
    if (pt) this.open.points.push(pt)
  }

  private close(endAt: number): void {
    const e = this.open
    if (!e) return
    this.open = null
    const kind: EpisodeKind = e.kinds.has('track')
      ? 'track'
      : e.kinds.has('seek')
        ? 'seek'
        : e.kinds.has('play')
          ? 'play'
          : e.kinds.has('pause')
            ? 'pause'
            : 'drift'
    const end = Math.max(endAt, e.firstBadAt)
    this.episodes.push({
      kind,
      startAt: e.startAt,
      firstBadAt: e.firstBadAt,
      endAt: end,
      relockMs: end - e.startAt,
      relockMinMs: end - e.firstBadAt,
    })
    // Unexplained excursions are drift and count in the stats; jump episodes are re-lock data.
    if (kind === 'drift') this.points.push(...e.points)
    this.points.push(...e.goodRun)
    const lastPt = e.goodRun.at(-1)
    if (lastPt) this.lastGoodAt = lastPt.at
    this.points.sort((a, b) => a.at - b.at)
  }

  /** Period from the audio alone (longest run of single-period intervals), as a tempo check. */
  fittedPeriod(): number | null {
    const P = this.periodMs
    let best: number[] = []
    let run: number[] = []
    for (const at of this.accepted) {
      const prev = run.at(-1)
      if (prev !== undefined && Math.abs(at - prev - P) > 0.12 * P) {
        if (run.length > best.length) best = run
        run = []
      }
      run.push(at)
    }
    if (run.length > best.length) best = run
    if (best.length < 16) return null
    return slope(
      best.map((_, i) => i),
      best,
    )
  }

  summary(): Summary {
    const abs = this.points.map((p) => Math.abs(p.driftMs)).sort((a, b) => a - b)
    const has = abs.length > 0
    const fitted = this.fittedPeriod()
    const firstTrackCal = this.cal.values().next()
    return {
      periodMs: this.periodMs,
      calibrated: this.firstCalAt !== null,
      calibrationPhaseMs: firstTrackCal.done ? null : firstTrackCal.value,
      measuredFromAt: this.firstCalAt,
      measuredForMs: has && this.firstCalAt !== null ? (this.points.at(-1) as DriftPoint).at - this.firstCalAt : 0,
      points: abs.length,
      medianAbsMs: has ? quantile(abs, 0.5) : null,
      p95AbsMs: has ? quantile(abs, 0.95) : null,
      maxAbsMs: has ? (abs.at(-1) as number) : null,
      meanMs: has ? this.points.reduce((a, p) => a + p.driftMs, 0) / abs.length : null,
      slopeMsPerMin:
        abs.length >= 10
          ? slope(
              this.points.map((p) => p.at / 60_000),
              this.points.map((p) => p.driftMs),
            )
          : null,
      onsets: this.onsets,
      rejected: this.rejected,
      unclocked: this.unclocked,
      episodes: [...this.episodes],
      fittedPeriodMs: fitted,
      periodPpm: fitted === null ? null : ((fitted - this.periodMs) / this.periodMs) * 1e6,
    }
  }
}
