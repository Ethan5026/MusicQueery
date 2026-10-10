// SpotifyClock (D-03, D-16): polls GET /me/player, places each sample at the midpoint of its
// request (RTT/2 correction), and interpolates with performance.now() in between.
//
// Spotify's `timestamp` is when playback state last changed, not when progress_ms was sampled,
// so it is logged but not used. While playing, each sample estimates the "origin": the
// performance time at which the track was at 0 ms. The estimate is the median origin of the
// lowest-RTT third of the samples since the last jump, because a short round trip bounds the error.

import type { Clock, JumpEvent, JumpKind } from './types'

export interface PlayerReading {
  /** HTTP status: 200 with a body, 204 when nothing is active. */
  status: number
  progressMs: number | null
  isPlaying: boolean
  trackId: string | null
  durationMs: number | null
  /** Spotify's `timestamp` (Unix ms of the last state change). Logged for SP2 only. */
  timestamp: number | null
  deviceId: string | null
  deviceName: string | null
  trackName: string | null
  artists: string | null
  /** Seconds to wait after a 429. */
  retryAfterS?: number
}

export interface PlayerSample extends PlayerReading {
  t0: number
  t1: number
}

export interface SpotifyClockOptions {
  fetchPlayer: () => Promise<PlayerReading>
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  intervalMs?: number
  pausedIntervalMs?: number
  /** Poll again this soon after a jump, to firm up the new estimate. */
  fastFollowMs?: number
  jumpThresholdMs?: number
  /** Samples kept per segment for the origin estimate. */
  window?: number
  /** Per-output-device offset (ms) added to the position; negative = audio lags. */
  offsetFor?: (deviceId: string | null) => number
  onError?: (err: unknown) => void
}

interface Segment {
  trackId: string | null
  playing: boolean
  /** Origins (perf ms at track position 0) with their RTTs; only while playing. */
  origins: { origin: number; rtt: number }[]
  /** Position while paused. */
  pausedMs: number
  origin: number
}

export class SpotifyClock implements Clock {
  readonly samples: PlayerSample[] = []
  last: PlayerSample | null = null
  lastError: unknown = null

  private readonly opt: Required<Omit<SpotifyClockOptions, 'onError'>> & Pick<SpotifyClockOptions, 'onError'>
  private seg: Segment | null = null
  private timer: unknown = null
  private running = false
  private inFlight = false
  private jumpSubs = new Set<(e: JumpEvent) => void>()
  private sampleSubs = new Set<(s: PlayerSample) => void>()

  constructor(options: SpotifyClockOptions) {
    this.opt = {
      now: () => performance.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      intervalMs: 1000,
      pausedIntervalMs: 5000,
      fastFollowMs: 250,
      jumpThresholdMs: 400,
      window: 12,
      offsetFor: () => 0,
      ...options,
    }
  }

  get playing(): boolean {
    return this.seg?.playing ?? false
  }

  get trackId(): string | null {
    return this.seg?.trackId ?? null
  }

  get locked(): boolean {
    return this.seg !== null
  }

  get offsetMs(): number {
    return this.opt.offsetFor(this.last?.deviceId ?? null)
  }

  /** Position from Spotify's report alone, before the device offset. */
  rawPositionMs(at = this.opt.now()): number {
    const s = this.seg
    if (!s) return 0
    return s.playing ? at - s.origin : s.pausedMs
  }

  positionMs(at = this.opt.now()): number {
    return this.rawPositionMs(at) + this.offsetMs
  }

  onJump(cb: (e: JumpEvent) => void): () => void {
    this.jumpSubs.add(cb)
    return () => this.jumpSubs.delete(cb)
  }

  onSample(cb: (s: PlayerSample) => void): () => void {
    this.sampleSubs.add(cb)
    return () => this.sampleSubs.delete(cb)
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.poll()
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) this.opt.clearTimer(this.timer)
    this.timer = null
  }

  /** Poll now (e.g. after our own play/seek command). */
  pollNow(): void {
    if (this.timer !== null) this.opt.clearTimer(this.timer)
    this.timer = null
    void this.poll()
  }

  private schedule(ms: number): void {
    if (!this.running) return
    if (this.timer !== null) this.opt.clearTimer(this.timer)
    this.timer = this.opt.setTimer(() => {
      this.timer = null
      void this.poll()
    }, ms)
  }

  private async poll(): Promise<void> {
    if (this.inFlight) return
    this.inFlight = true
    let next = this.opt.intervalMs
    try {
      const t0 = this.opt.now()
      const reading = await this.opt.fetchPlayer()
      const t1 = this.opt.now()
      const sample: PlayerSample = { ...reading, t0, t1 }
      this.lastError = null
      if (reading.status === 429) {
        next = Math.max(1, reading.retryAfterS ?? 5) * 1000
      } else {
        const jumped = this.ingest(sample)
        if (jumped) next = this.opt.fastFollowMs
        else if (!this.playing) next = this.opt.pausedIntervalMs
      }
    } catch (err) {
      this.lastError = err
      this.opt.onError?.(err)
      next = this.opt.pausedIntervalMs
    } finally {
      this.inFlight = false
    }
    this.schedule(next)
  }

  /** Apply one sample. Returns true if it caused a jump. Public for tests and replays. */
  ingest(sample: PlayerSample): boolean {
    this.samples.push(sample)
    if (this.samples.length > 4000) this.samples.splice(0, 1000)
    this.last = sample
    for (const cb of this.sampleSubs) cb(sample)

    const tMid = (sample.t0 + sample.t1) / 2
    const rtt = sample.t1 - sample.t0
    const active = sample.status === 200 && sample.progressMs !== null && sample.trackId !== null
    const before = this.seg ? this.rawPositionMs(tMid) : 0

    if (!active) {
      if (this.seg) {
        this.seg = null
        this.emit({ at: sample.t1, kind: 'idle', fromMs: before, toMs: 0, trackId: null })
        return true
      }
      return false
    }

    const progress = sample.progressMs as number
    const origin = tMid - progress
    const s = this.seg
    let kind: JumpKind | null = null
    if (!s) kind = 'lock'
    else if (s.trackId !== sample.trackId) kind = 'track'
    else if (s.playing !== sample.isPlaying) kind = sample.isPlaying ? 'play' : 'pause'
    else if (Math.abs(progress - before) > this.opt.jumpThresholdMs) kind = 'seek'

    if (kind) {
      this.seg = {
        trackId: sample.trackId,
        playing: sample.isPlaying,
        origins: sample.isPlaying ? [{ origin, rtt }] : [],
        pausedMs: progress,
        origin,
      }
      this.emit({ at: sample.t1, kind, fromMs: before, toMs: progress, trackId: sample.trackId })
      return true
    }

    const seg = s as Segment
    if (seg.playing) {
      seg.origins.push({ origin, rtt })
      if (seg.origins.length > this.opt.window) seg.origins.shift()
      seg.origin = estimateOrigin(seg.origins)
    } else {
      seg.pausedMs = progress
    }
    return false
  }

  private emit(e: JumpEvent): void {
    for (const cb of this.jumpSubs) cb(e)
  }
}

/** Median origin of the lowest-RTT third of the samples (at least one). */
export function estimateOrigin(origins: { origin: number; rtt: number }[]): number {
  const best = [...origins].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(origins.length / 3)))
  const o = best.map((x) => x.origin).sort((a, b) => a - b)
  const mid = o.length >> 1
  return o.length % 2 ? (o[mid] as number) : ((o[mid - 1] as number) + (o[mid] as number)) / 2
}
