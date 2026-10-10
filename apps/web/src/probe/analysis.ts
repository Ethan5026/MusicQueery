// Drift probe analysis (pure). The mic hears a metronome track; every click lies on a grid
// k·P + c in track time. For each click we read the clock's predicted position at the moment
// the click was heard; its phase on the grid should stay constant. Drift is the phase's change
// from the track's reference phase, so the unknown click offset c and fixed latencies cancel out.
//
// Live, each track is calibrated on its first clicks and errors beyond the tolerance open an
// "episode" that ends when the clock re-locks. Episodes with a user jump (seek, skip, pause/play)
// are re-lock data; the others are drift. If the clock settles on a new phase with no user jump
// (a Spotify 'resync'), that is a step: recorded, then recalibrated so the probe carries on.
// The summary measures every non-jump click against the track's reference phase over the whole
// run (circular median), so the majority state is the reference, not the first 20 s.

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

export type EpisodeKind = 'seek' | 'track' | 'play' | 'pause' | 'resync' | 'drift'

/** Episodes caused by the user; their clicks are re-lock data, not drift. */
const USER_JUMPS: readonly EpisodeKind[] = ['seek', 'track', 'play', 'pause']

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

export interface Step {
  at: number
  trackId: string
  /** New phase − old phase. */
  sizeMs: number
}

export interface DriftPoint {
  at: number
  driftMs: number
}

export interface Summary {
  periodMs: number
  calibrated: boolean
  /** Reference phase of the first track (= device offset if its first click is at 0 ms). */
  referencePhaseMs: number | null
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
  /** Clicks inside user-jump episodes (left out of the drift stats). */
  excluded: number
  episodes: Episode[]
  steps: Step[]
  /** Set while out of lock: when the open episode's first bad click was heard. */
  outOfLockSinceAt: number | null
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
  /** Consecutive bad clicks on one stable phase that count as a step. */
  stepRun?: number
  stepSpreadMs?: number
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

interface Measured {
  at: number
  trackId: string
  phase: number
  /** Inside a user-jump episode. */
  excluded: boolean
  /** Inside the currently open episode (not yet classified). */
  pending: boolean
}

interface OpenEpisode {
  startAt: number
  firstBadAt: number
  kinds: Set<EpisodeKind>
  clicks: Measured[]
  goodRun: Measured[]
  badRun: Measured[]
}

export class DriftAnalyzer {
  readonly periodMs: number
  /** Live drift against the live calibration, for the plot. */
  readonly points: DriftPoint[] = []
  readonly episodes: Episode[] = []
  readonly steps: Step[] = []
  private readonly calibrateMs: number
  private readonly calibrateMin: number
  private readonly tol: number
  private readonly relockRun: number
  private readonly stepRun: number
  private readonly stepSpread: number

  private cal = new Map<string, number>()
  private pending = new Map<string, { at: number; phase: number }[]>()
  private measured: Measured[] = []
  private accepted: number[] = []
  private lastHeardAt: number | undefined
  private onsets = 0
  private rejected = 0
  private unclocked = 0
  private lastGoodAt: number | null = null
  private open: OpenEpisode | null = null
  private firstCalAt: number | null = null
  private firstTrack: string | null = null

  constructor(o: AnalyzerOptions) {
    this.periodMs = o.periodMs
    this.calibrateMs = o.calibrateMs ?? 20_000
    this.calibrateMin = o.calibrateMin ?? 8
    this.tol = o.toleranceMs ?? 150
    this.relockRun = o.relockRun ?? 3
    this.stepRun = o.stepRun ?? 8
    this.stepSpread = o.stepSpreadMs ?? 40
  }

  /** Clock jumps classify the episode they fall in. */
  addJump(kind: string, at: number): void {
    const k = (['seek', 'track', 'play', 'pause', 'resync'] as const).find((x) => x === kind)
    if (!k || !this.open) return
    this.open.kinds.add(k)
    // A new track needs its own calibration, so the episode ends when the clock sees the change.
    if (k === 'track') this.close(at)
  }

  /** Returns the live drift for this click, or null while rejected, unclocked or calibrating. */
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
    const m: Measured = { at: o.at, trackId: clock.trackId, phase, excluded: false, pending: false }
    this.measured.push(m)
    const d = wrap(phase - cal, P)
    this.points.push({ at: o.at, driftMs: d })
    if (Math.abs(d) <= this.tol) this.good(m)
    else this.bad(audibleAt, m)
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
      if (first) {
        this.firstCalAt = at
        this.firstTrack = trackId
      }
      this.lastGoodAt = at
    }
  }

  private good(m: Measured): void {
    if (!this.open) {
      this.lastGoodAt = m.at
      return
    }
    m.pending = true
    this.open.badRun = []
    this.open.goodRun.push(m)
    if (this.open.goodRun.length >= this.relockRun) this.close((this.open.goodRun[0] as Measured).at)
  }

  private bad(at: number, m: Measured | null): void {
    if (this.firstCalAt === null) return
    if (!this.open) {
      const last = this.lastGoodAt ?? at
      this.open = {
        startAt: Math.max(last, at - this.periodMs),
        firstBadAt: at,
        kinds: new Set(),
        clicks: [],
        goodRun: [],
        badRun: [],
      }
    }
    const e = this.open
    // A bad click breaks the good run; its clicks stay with the episode.
    e.clicks.push(...e.goodRun)
    e.goodRun = []
    if (!m) {
      e.badRun = []
      return
    }
    m.pending = true
    e.clicks.push(m)
    e.badRun.push(m)
    this.maybeStep(e)
  }

  /** No user jump, and the clock has settled on a new phase: record a step and recalibrate. */
  private maybeStep(e: OpenEpisode): void {
    if ([...e.kinds].some((k) => USER_JUMPS.includes(k))) return
    const run = e.badRun.slice(-this.stepRun)
    if (run.length < this.stepRun || run.some((m) => m.trackId !== (run[0] as Measured).trackId)) return
    const phases = run.map((m) => m.phase)
    const centre = circularMedian(phases, this.periodMs)
    if (phases.some((p) => Math.abs(wrap(p - centre, this.periodMs)) > this.stepSpread / 2)) return
    const trackId = (run[0] as Measured).trackId
    const old = this.cal.get(trackId) ?? centre
    this.steps.push({ at: (run[0] as Measured).at, trackId, sizeMs: wrap(centre - old, this.periodMs) })
    this.cal.set(trackId, centre)
    e.goodRun = []
    this.close((run[0] as Measured).at)
  }

  private close(endAt: number): void {
    const e = this.open
    if (!e) return
    this.open = null
    const kind: EpisodeKind =
      (['track', 'seek', 'play', 'pause', 'resync'] as const).find((k) => e.kinds.has(k)) ?? 'drift'
    const end = Math.max(endAt, e.firstBadAt)
    this.episodes.push({
      kind,
      startAt: e.startAt,
      firstBadAt: e.firstBadAt,
      endAt: end,
      relockMs: end - e.startAt,
      relockMinMs: end - e.firstBadAt,
    })
    // Clicks before re-lock in a user-jump episode are re-lock data, not drift.
    const userJump = USER_JUMPS.includes(kind)
    for (const m of e.clicks) {
      m.pending = false
      if (userJump && m.at < end) m.excluded = true
    }
    for (const m of e.goodRun) m.pending = false
    const lastGood = e.goodRun.at(-1)
    this.lastGoodAt = lastGood ? lastGood.at : end
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
    const P = this.periodMs
    const used = this.measured.filter((m) => !m.excluded && !m.pending)
    const byTrack = new Map<string, number[]>()
    for (const m of used) byTrack.set(m.trackId, [...(byTrack.get(m.trackId) ?? []), m.phase])
    const ref = new Map([...byTrack].map(([t, ph]) => [t, circularMedian(ph, P)]))
    const drift = used.map((m) => ({ at: m.at, d: wrap(m.phase - (ref.get(m.trackId) as number), P) }))
    const abs = drift.map((x) => Math.abs(x.d)).sort((a, b) => a - b)
    const has = abs.length > 0
    const fitted = this.fittedPeriod()
    return {
      periodMs: P,
      calibrated: this.firstCalAt !== null,
      referencePhaseMs: this.firstTrack === null ? null : (ref.get(this.firstTrack) ?? null),
      measuredFromAt: this.firstCalAt,
      measuredForMs: has ? (drift.at(-1) as { at: number }).at - (drift[0] as { at: number }).at : 0,
      points: abs.length,
      medianAbsMs: has ? quantile(abs, 0.5) : null,
      p95AbsMs: has ? quantile(abs, 0.95) : null,
      maxAbsMs: has ? (abs.at(-1) as number) : null,
      meanMs: has ? drift.reduce((a, x) => a + x.d, 0) / abs.length : null,
      slopeMsPerMin:
        abs.length >= 10
          ? slope(
              drift.map((x) => x.at / 60_000),
              drift.map((x) => x.d),
            )
          : null,
      onsets: this.onsets,
      rejected: this.rejected,
      unclocked: this.unclocked,
      excluded: this.measured.filter((m) => m.excluded).length,
      episodes: [...this.episodes],
      steps: [...this.steps],
      outOfLockSinceAt: this.open?.firstBadAt ?? null,
      fittedPeriodMs: fitted,
      periodPpm: fitted === null ? null : ((fitted - P) / P) * 1e6,
    }
  }
}
