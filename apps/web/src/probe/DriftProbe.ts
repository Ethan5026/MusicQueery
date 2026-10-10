// Drift probe wiring: mic → onset worklet → DriftAnalyzer against SpotifyClock.
// Play a metronome track (known BPM); the phone listens and compares each click with the clock.

import type { SpotifyClock } from '../clock/SpotifyClock'
import type { JumpEvent } from '../clock/types'
import { API_URL, BUILD, isStandalone } from '../config'
import { log } from '../debug/log'
import { DriftAnalyzer, type Summary } from './analysis'
import workletUrl from './onset-processor.js?url'

export interface RawOnset {
  at: number
  level: number
  posMs: number
  playing: boolean
  trackId: string | null
  driftMs: number | null
}

export interface ProbeOptions {
  bpm: number
  /** Onset threshold, peak / noise floor. */
  ratio: number
  toleranceMs: number
}

export class DriftProbe {
  readonly analyzer: DriftAnalyzer
  readonly onsets: RawOnset[] = []
  readonly jumps: JumpEvent[] = []
  meter = { peak: 0, floor: 0 }
  startedAt = 0
  startedWall = 0
  audioInfo: Record<string, unknown> = {}
  running = false

  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private offJump: (() => void) | null = null
  private subs = new Set<() => void>()

  constructor(
    private readonly clock: SpotifyClock,
    readonly opts: ProbeOptions,
  ) {
    this.analyzer = new DriftAnalyzer({ periodMs: 60_000 / opts.bpm, toleranceMs: opts.toleranceMs })
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb)
    return () => this.subs.delete(cb)
  }

  private changed(): void {
    for (const cb of this.subs) cb()
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    const ctx = new AudioContext()
    this.ctx = ctx
    await ctx.resume()
    await ctx.audioWorklet.addModule(workletUrl)
    const src = ctx.createMediaStreamSource(this.stream)
    const node = new AudioWorkletNode(ctx, 'onset-processor')
    this.node = node
    node.port.postMessage({ refractoryS: (0.6 * 60) / this.opts.bpm, ratio: this.opts.ratio })
    const mute = ctx.createGain()
    mute.gain.value = 0
    src.connect(node).connect(mute).connect(ctx.destination)
    node.port.onmessage = (e: MessageEvent) => this.onMessage(e.data as WorkletMsg)
    this.offJump = this.clock.onJump((j) => {
      this.jumps.push(j)
      this.analyzer.addJump(j.kind, j.at)
      this.changed()
    })
    const track = this.stream.getAudioTracks()[0]
    this.audioInfo = {
      sampleRate: ctx.sampleRate,
      baseLatency: ctx.baseLatency,
      outputLatency: ctx.outputLatency,
      hasOutputTimestamp: typeof ctx.getOutputTimestamp === 'function',
      trackSettings: track?.getSettings(),
    }
    this.startedAt = performance.now()
    this.startedWall = Date.now()
    this.running = true
    log('info', 'probe.start', { ...this.opts, ...this.audioInfo })
    this.changed()
  }

  async stop(): Promise<void> {
    this.running = false
    this.offJump?.()
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close()
    this.ctx = null
    log('info', 'probe.stop', this.analyzer.summary())
    this.changed()
  }

  /** Frame → performance.now() time, via the context's output timestamp when available. */
  private perfTimeOfFrame(frame: number): number {
    const ctx = this.ctx as AudioContext
    const t = frame / ctx.sampleRate
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null
    if (ts && ts.performanceTime && ts.contextTime !== undefined) {
      return ts.performanceTime - ((ts.contextTime ?? 0) - t) * 1000
    }
    return performance.now() - (ctx.currentTime - t) * 1000
  }

  private onMessage(msg: WorkletMsg): void {
    if (msg.type === 'meter') {
      this.meter = { peak: msg.peak, floor: msg.floor }
      this.changed()
      return
    }
    const at = this.perfTimeOfFrame(msg.frame)
    const posMs = this.clock.rawPositionMs(at)
    const playing = this.clock.playing
    const trackId = this.clock.trackId
    const driftMs = this.analyzer.addOnset({ at, level: msg.level }, { trackId, playing, posMs })
    this.onsets.push({ at, level: msg.level, posMs, playing, trackId, driftMs })
    this.changed()
  }

  summary(): Summary {
    return this.analyzer.summary()
  }

  report(extra: Record<string, unknown>): Record<string, unknown> {
    const since = this.startedAt - 5000
    return {
      kind: 'drift-probe',
      build: BUILD,
      ua: navigator.userAgent,
      standalone: isStandalone(),
      startedAt: new Date(this.startedWall).toISOString(),
      startedPerf: this.startedAt,
      options: this.opts,
      audio: this.audioInfo,
      summary: this.summary(),
      jumps: this.jumps,
      onsets: this.onsets,
      samples: this.clock.samples.filter((s) => s.t0 >= since),
      ...extra,
    }
  }

  async upload(extra: Record<string, unknown>): Promise<string> {
    if (!API_URL) throw new Error('VITE_API_URL is not set')
    const res = await fetch(`${API_URL}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(this.report(extra)),
    })
    if (!res.ok) throw new Error(`upload ${res.status}`)
    const { key } = (await res.json()) as { key: string }
    log('info', 'probe.uploaded', { key })
    return key
  }
}

type WorkletMsg =
  | { type: 'onset'; frame: number; level: number; floor: number }
  | { type: 'meter'; peak: number; floor: number }
