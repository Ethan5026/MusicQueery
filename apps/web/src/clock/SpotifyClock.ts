// SpotifyClock (D-03, D-16): polls GET /me/player, places each sample at the midpoint of its
// request (RTT/2 correction), and interpolates with performance.now() in between.
//
// While playing, each sample estimates the "origin": the performance time at which the track was
// at 0 ms. The estimate is the median origin of the lowest-RTT third of the samples since the
// last jump, because a short round trip bounds the error.
//
// Spotify's `timestamp` is when the playing device last reported its state; between reports the
// server extrapolates progress_ms. A device can report again with no user action, moving the
// position by a few hundred ms (measured in M1 on a Fire TV: −310 ms 30 s after a start, −290 ms
// 1.9 s after a seek). A new timestamp therefore starts a new segment ('resync').
//
// That correction repeats per device: after every fresh start (seek, skip, or play from a new
// position), the reports run ahead of the audio until the device resyncs. Resuming a pause at the
// same position is not affected (the audio is still buffered). So each resync after a fresh start
// teaches a per-device "start bias", applied from the next fresh start until its resync.

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
  /** Learned per-device start bias (see above). Defaults to memory only. */
  startBias?: BiasStore
  onError?: (err: unknown) => void
}

export interface BiasStore {
  get(deviceId: string | null): number
  set(deviceId: string, ms: number): void
}

export function memoryBiasStore(): BiasStore {
  const m = new Map<string, number>()
  return { get: (id) => (id ? (m.get(id) ?? 0) : 0), set: (id, ms) => void m.set(id, ms) }
}

/** A resync within this window of a fresh start teaches the bias. */
const BIAS_LEARN_WINDOW_MS = 60_000
const BIAS_MAX_MS = 1500

interface Segment {
  trackId: string | null
  playing: boolean
  timestamp: number | null
  deviceId: string | null
  /** Started by a seek, skip, or play from a new position (or the first lock). */
  fresh: boolean
  startedAt: number
  /** Start bias applied to this segment (0 once the device has resynced). */
  bias: number
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
  /** performance time of the last answered poll (not a 429). */
  lastOkAt: number | null = null

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
      startBias: memoryBiasStore(),
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

  /** Start bias applied right now (ms). */
  get biasMs(): number {
    return this.seg?.playing ? this.seg.bias : 0
  }

  /** For the sync badge: age of the current segment, its playing samples, and an error estimate in ms
   *  (half the best round trip plus the spread of the origins). Null when nothing is playing. */
  quality(at = this.opt.now()): { sinceMs: number; samples: number; errMs: number } | null {
    const s = this.seg
    if (!s) return null
    const n = s.origins.length
    let errMs = Infinity
    if (n) {
      const minRtt = Math.min(...s.origins.map((o) => o.rtt))
      const dev = s.origins.map((o) => Math.abs(o.origin - s.origin)).sort((a, b) => a - b)
      errMs = minRtt / 2 + (dev[dev.length >> 1] ?? 0)
    }
    return { sinceMs: at - s.startedAt, samples: n, errMs }
  }

  /** Position from Spotify's report and the start bias, before the device offset. */
  rawPositionMs(at = this.opt.now()): number {
    const s = this.seg
    if (!s) return 0
    return s.playing ? at - s.origin + s.bias : s.pausedMs
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
    if (sample.status !== 429) this.lastOkAt = sample.t1
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
    else if (s.timestamp !== sample.timestamp) kind = 'resync'

    if (kind === 'resync' && s && s.playing && s.fresh) {
      const delta = progress - (tMid - s.origin)
      if (tMid - s.startedAt < BIAS_LEARN_WINDOW_MS && Math.abs(delta) < BIAS_MAX_MS && sample.deviceId) {
        const prev = this.opt.startBias.get(sample.deviceId)
        this.opt.startBias.set(sample.deviceId, prev === 0 ? delta : (prev + delta) / 2)
      }
    }

    if (kind) {
      const moved = kind === 'play' && s !== null && Math.abs(progress - s.pausedMs) > this.opt.jumpThresholdMs
      const startedFresh = kind === 'seek' || kind === 'track' || moved
      const bias = sample.isPlaying && startedFresh ? this.opt.startBias.get(sample.deviceId) : 0
      this.seg = {
        trackId: sample.trackId,
        playing: sample.isPlaying,
        timestamp: sample.timestamp,
        deviceId: sample.deviceId,
        fresh: startedFresh || kind === 'lock',
        startedAt: sample.t1,
        bias,
        origins: sample.isPlaying ? [{ origin, rtt }] : [],
        pausedMs: progress,
        origin,
      }
      this.emit({ at: sample.t1, kind, fromMs: before, toMs: progress + bias, trackId: sample.trackId })
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
