// The band engine (M6, D-21) and its AudioClock (D-16). A look-ahead scheduler (setInterval every 25 ms, events
// placed up to a bar ahead on the AudioContext clock, so timer jitter never reaches the sound) asks the arranger for
// one bar at a time and starts sample voices at exact context times. The clock maps "now" to the audible position
// through getOutputTimestamp(), so the screens show what is heard, not what is scheduled; the timeline it drives is
// the chart's exact timeline at the same tempo (chartTimeline), so beat b is at b × 60000 / bpm ms on both.
import { Arranger, type BandEvent, type BandStyle, type Form, type Part, barAt, formFromChart } from '@mq/band'
import type { Chart, Timeline } from '@mq/model'
import { chartTimeline } from '@mq/theory'
import type { Clock, JumpEvent, JumpKind } from '../clock/types'
import { log } from '../debug/log'
import { type Kit, nearestSample } from './kit'

/** How far ahead of the audio clock bars are generated (s). */
const LOOKAHEAD = 0.25
const TICK_MS = 25
/** Start margin after play/seek (s): long enough for the first bar's voices to be set up. */
const START_DELAY = 0.08

const PART_LEVEL: Record<Part, number> = { piano: 0.3, bass: 0.62, drums: 1 }
const DRUM_LEVEL: Record<string, number> = {
  ride: 0.22, bell: 0.18, crash: 0.22, hhfoot: 0.28, hhclosed: 0.2, hhopen: 0.18,
  kick: 0.55, snare: 0.38, ghost: 0.26, xstick: 0.34, shaker: 0.2,
}
const RELEASE: Record<'piano' | 'bass', number> = { piano: 0.14, bass: 0.07 }

export interface BandOptions {
  bpm: number
  style: BandStyle
  choruses: number
  /** count-in bars before each start from pause (0–2) */
  countIn: number
  seed?: number
}

export interface Loop {
  startMs: number
  endMs: number
}

/** Scheduler health for the SP5 audio test. */
export interface BandStats {
  ticks: number
  /** timer gaps (ms): largest, and how many over 50 / 100 ms */
  gapMaxMs: number
  gapsOver50: number
  gapsOver100: number
  /** time between scheduling and sounding (ms): the smallest seen, and voices that were already late */
  minLeadMs: number
  late: number
  /** how late the latest of those started (ms) */
  maxLateMs: number
  voices: number
  /** ticks where the audio clock advanced less than half the wall time (an output stall) */
  stalls: number
  /** audio clock rate against performance.now(), parts per million */
  driftPpm: number
  startedAt: number
}

const freshStats = (): BandStats => ({
  ticks: 0, gapMaxMs: 0, gapsOver50: 0, gapsOver100: 0, minLeadMs: Infinity, late: 0, maxLateMs: 0, voices: 0, stalls: 0, driftPpm: 0,
  startedAt: performance.now(),
})

interface Voice {
  src: AudioBufferSourceNode
  gain: GainNode
  start: number
  end: number
}

export class BandEngine implements Clock {
  trackId: string | null = null
  timeline: Timeline | null = null
  chart: Chart | null = null
  opts: BandOptions = { bpm: 120, style: 'swing', choruses: 3, countIn: 1 }
  loop: Loop | null = null
  stats: BandStats = freshStats()

  private ctx: AudioContext | null = null
  private kit: Kit | null = null
  private out: Record<Part, GainNode> | null = null
  private mutes: Record<Part, boolean> = { piano: false, bass: false, drums: false }
  private form: Form | null = null
  private arranger: Arranger | null = null
  private _playing = false
  private pausedBeat = 0
  private anchors: Array<{ time: number; beat: number }> = []
  private holdUntil = 0
  private holdBeat = 0
  private nextBar = 0
  private nextBarTime = 0
  private skipBefore = -Infinity
  private voices: Voice[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private lastTick: { perf: number; audio: number } | null = null
  private drift = { audio: 0, perf: 0 }
  private subs = new Set<(e: JumpEvent) => void>()

  get playing(): boolean {
    return this._playing
  }

  get ready(): boolean {
    return this.ctx !== null && this.kit !== null
  }

  get durationMs(): number {
    return this.timeline?.durationMs ?? 0
  }

  private get spb(): number {
    return 60 / this.opts.bpm
  }

  private get msPerBeat(): number {
    return 60000 / this.opts.bpm
  }

  /** Wires the engine to a running context and a loaded kit (after the first tap). */
  attach(ctx: AudioContext, kit: Kit): void {
    if (this.ctx === ctx && this.kit === kit) return
    this.ctx = ctx
    this.kit = kit
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.knee.value = 8
    comp.ratio.value = 3
    comp.attack.value = 0.004
    comp.release.value = 0.2
    const master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(comp).connect(ctx.destination)
    const part = (p: Part) => {
      const g = ctx.createGain()
      g.gain.value = this.mutes[p] ? 0 : 1
      g.connect(master)
      return g
    }
    this.out = { piano: part('piano'), bass: part('bass'), drums: part('drums') }
  }

  onJump(cb: (e: JumpEvent) => void): () => void {
    this.subs.add(cb)
    return () => this.subs.delete(cb)
  }

  private emit(kind: JumpKind, fromMs: number): void {
    const e: JumpEvent = { at: performance.now(), kind, fromMs, toMs: this.positionMs(), trackId: this.trackId }
    for (const cb of this.subs) cb(e)
  }

  // ------------------------------------------------------------ chart

  /** Loads a chart paused at the top; returns its exact timeline. */
  load(chart: Chart, opts: BandOptions): Timeline {
    const from = this.positionMs()
    this.stop(0.03)
    this.chart = chart
    this.opts = { ...opts }
    this.rebuild()
    this.pausedBeat = 0
    this.loop = null
    this.emit('track', from)
    return this.timeline!
  }

  /** Changes tempo, style, choruses or the chart itself (a new key) while keeping the place in the form. */
  update(patch: Partial<BandOptions> & { chart?: Chart }): Timeline | null {
    if (!this.chart) return null
    const beat = this.beatNow()
    const from = this.positionMs()
    if (patch.chart) this.chart = patch.chart
    const o: Partial<BandOptions> & { chart?: Chart } = { ...patch }
    delete o.chart
    this.opts = { ...this.opts, ...o }
    const needsTimeline = patch.chart !== undefined || patch.bpm !== undefined || patch.choruses !== undefined
    if (needsTimeline) this.rebuild()
    else if (this.arranger) this.arranger.style = this.opts.style
    const total = this.form?.totalBeats ?? 0
    const b = Math.min(beat, Math.max(0, total - 1e-6))
    if (this._playing) this.restart(b, false, false)
    else this.pausedBeat = b
    this.emit('seek', from)
    return this.timeline
  }

  private rebuild(): void {
    const chart = this.chart!
    this.form = formFromChart(chart, this.opts.choruses)
    this.arranger = new Arranger(this.form, { style: this.opts.style, bpm: this.opts.bpm, seed: this.opts.seed ?? 1 })
    this.timeline = chartTimeline(chart, { bpm: this.opts.bpm, choruses: this.opts.choruses })
    this.trackId = this.timeline.id
  }

  setMute(part: Part, muted: boolean): void {
    this.mutes[part] = muted
    const g = this.out?.[part]
    if (g && this.ctx) g.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.015)
  }

  setLoop(loop: Loop | null): void {
    this.loop = loop
    // a loop set behind the playhead, or ending before it, takes effect from the next pass
    if (this._playing) this.restart(this.beatNow(), false, false)
  }

  // ------------------------------------------------------------ transport

  play(): void {
    if (this._playing || !this.form || !this.ready) return
    const from = this.positionMs()
    let b = this.pausedBeat
    if (b >= this.form.totalBeats - 1e-6) b = 0
    if (this.loop && (b * this.msPerBeat < this.loop.startMs - 1 || b * this.msPerBeat >= this.loop.endMs - 1)) b = this.loop.startMs / this.msPerBeat
    this._playing = true
    this.restart(b, this.opts.countIn > 0, true)
    this.emit('play', from)
  }

  pause(): void {
    if (!this._playing) return
    const from = this.positionMs()
    this.pausedBeat = this.beatNow()
    this._playing = false
    this.stop(0.03)
    this.emit('pause', from)
  }

  toggle(): void {
    if (this._playing) this.pause()
    else this.play()
  }

  seek(ms: number): void {
    if (!this.form) return
    const from = this.positionMs()
    const b = Math.min(Math.max(0, ms / this.msPerBeat), this.form.totalBeats)
    if (this._playing) this.restart(b, false, true)
    else this.pausedBeat = b
    this.emit('seek', from)
  }

  /** Called every frame: stops at the end of the form. */
  checkEnd(): boolean {
    if (this._playing && this.form && this.beatNow() >= this.form.totalBeats) {
      const from = this.positionMs()
      this._playing = false
      this.pausedBeat = this.form.totalBeats
      this.stop(0.05)
      this.emit('pause', from)
      return true
    }
    return false
  }

  // ------------------------------------------------------------ clock

  /** Audio-context time being heard at performance time `at`. */
  private heardAt(at: number): number {
    const c = this.ctx!
    const ts = typeof c.getOutputTimestamp === 'function' ? c.getOutputTimestamp() : null
    if (ts && ts.performanceTime && ts.contextTime) return ts.contextTime + (at - ts.performanceTime) / 1000
    const lat = (c as AudioContext & { outputLatency?: number }).outputLatency || c.baseLatency || 0
    return c.currentTime - lat + (at - performance.now()) / 1000
  }

  private beatAtTime(t: number): number {
    if (t < this.holdUntil) return this.holdBeat
    let a = this.anchors[0]!
    for (const x of this.anchors) if (x.time <= t) a = x
    return a.beat + (t - a.time) / this.spb
  }

  /** The audible beat of the form (the paused beat when stopped). */
  beatNow(at: number = performance.now()): number {
    if (!this._playing || !this.ctx || this.anchors.length === 0) return this.pausedBeat
    return this.beatAtTime(this.heardAt(at))
  }

  positionMs(at?: number): number {
    const ms = this.beatNow(at) * this.msPerBeat
    return Math.min(this.durationMs, Math.max(0, ms))
  }

  /** Count-in beats still to come (0 once the form has started). */
  countInLeft(at: number = performance.now()): number {
    if (!this._playing || !this.ctx) return 0
    const t = this.heardAt(at)
    return t < this.holdUntil ? Math.ceil((this.holdUntil - t) / this.spb - 1e-6) : 0
  }

  // ------------------------------------------------------------ scheduling

  /**
   * Plays from beat `b`: cancels what was scheduled, optionally counts in, and schedules ahead from there.
   * `cut` fades out notes already sounding (seek, play); a tempo or style change lets them ring.
   */
  private restart(b: number, countIn: boolean, cut: boolean): void {
    const ctx = this.ctx!
    const form = this.form!
    this.stop(cut ? 0.02 : null)
    const now = ctx.currentTime + START_DELAY
    const n = countIn ? Math.round(this.opts.countIn) * form.meterNum : 0
    const tStart = now + n * this.spb
    if (n && this.arranger) {
      for (const e of this.arranger.countIn(Math.round(this.opts.countIn))) this.voice(e, tStart + e.beat * this.spb)
    }
    this.anchors = [{ time: tStart, beat: b }]
    this.holdUntil = tStart
    this.holdBeat = b
    const i = barAt(form, b)
    this.nextBar = i
    this.nextBarTime = tStart - (b - form.bars[i]!.startBeat) * this.spb
    this.skipBefore = b - 1e-6
    this.lastTick = null
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  /** Stops the scheduler and every voice still to start; `fade` (s) silences sounding ones too (null: let them ring). */
  private stop(fade: number | null): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    for (const v of this.voices) {
      if (v.start > now) {
        v.src.stop()
        v.src.disconnect()
      } else if (fade !== null && v.end > now) {
        v.gain.gain.cancelScheduledValues(now)
        v.gain.gain.setValueAtTime(v.gain.gain.value, now)
        v.gain.gain.linearRampToValueAtTime(0, now + fade)
        v.src.stop(now + fade + 0.01)
      }
    }
    this.voices = this.voices.filter((v) => v.start <= now && v.end > now && fade === null)
  }

  private tick(): void {
    const ctx = this.ctx
    const form = this.form
    const arr = this.arranger
    if (!ctx || !form || !arr || !this._playing) return
    const perf = performance.now()
    const st = this.stats
    st.ticks++
    if (this.lastTick) {
      const gap = perf - this.lastTick.perf
      const da = ctx.currentTime - this.lastTick.audio
      st.gapMaxMs = Math.max(st.gapMaxMs, gap)
      if (gap > 50) st.gapsOver50++
      if (gap > 100) st.gapsOver100++
      if (gap > 10 && da < (gap / 1000) * 0.5) st.stalls++
      this.drift.audio += da
      this.drift.perf += gap / 1000
      if (this.drift.perf > 5) st.driftPpm = Math.round((this.drift.audio / this.drift.perf - 1) * 1e6)
    }
    this.lastTick = { perf, audio: ctx.currentTime }

    const horizon = ctx.currentTime + LOOKAHEAD
    const loopStart = this.loop ? this.loop.startMs / this.msPerBeat : null
    const loopEnd = this.loop ? this.loop.endMs / this.msPerBeat : null
    while (this.nextBarTime <= horizon && this.nextBar < form.bars.length) {
      const bar = form.bars[this.nextBar]!
      for (const e of arr.bar(this.nextBar)) {
        if (e.beat < this.skipBefore) continue
        this.voice(e, this.nextBarTime + (e.beat - bar.startBeat) * this.spb)
      }
      this.skipBefore = -Infinity
      this.nextBarTime += bar.beats * this.spb
      const end = bar.startBeat + bar.beats
      if (loopStart !== null && loopEnd !== null && end >= loopEnd - 1e-6 && end - bar.beats < loopEnd - 1e-6) {
        this.nextBar = barAt(form, loopStart)
        this.anchors.push({ time: this.nextBarTime, beat: form.bars[this.nextBar]!.startBeat })
        // keep the anchors still needed to read the clock
        const keepFrom = this.anchors.findLastIndex((a) => a.time <= ctx.currentTime - 1)
        if (keepFrom > 0) this.anchors.splice(0, keepFrom)
      } else this.nextBar++
    }
    // drop voices that have finished
    if (this.voices.length > 64) {
      const now = ctx.currentTime
      this.voices = this.voices.filter((v) => v.end > now)
    }
  }

  private voice(e: BandEvent, t: number): void {
    const ctx = this.ctx!
    const kit = this.kit!
    const out = this.out!
    const lead = (t - ctx.currentTime) * 1000
    const st = this.stats
    st.voices++
    if (lead < st.minLeadMs) st.minLeadMs = lead
    if (lead < 0) {
      st.late++
      st.maxLateMs = Math.max(st.maxLateMs, -lead)
    }
    const src = ctx.createBufferSource()
    const gain = ctx.createGain()
    let end: number
    if (e.part === 'drums') {
      const s = kit.drums[e.piece]
      src.buffer = s.buffer
      src.playbackRate.value = 0.99 + Math.random() * 0.02
      gain.gain.value = Math.pow(e.vel, 1.4) * s.norm * (DRUM_LEVEL[e.piece] ?? 0.3)
      end = t + s.buffer.duration
      src.connect(gain).connect(out.drums)
      src.start(Math.max(t, ctx.currentTime), s.offset)
    } else {
      const s = nearestSample(e.part === 'piano' ? kit.piano : kit.bass, e.midi)
      src.buffer = s.buffer
      src.playbackRate.value = Math.pow(2, (e.midi - s.midi) / 12)
      const amp = Math.pow(e.vel, 1.5) * s.norm * PART_LEVEL[e.part]
      const off = t + e.dur * this.spb
      const rel = RELEASE[e.part]
      gain.gain.setValueAtTime(amp, Math.max(t, ctx.currentTime))
      gain.gain.setValueAtTime(amp, off)
      gain.gain.linearRampToValueAtTime(0, off + rel)
      end = off + rel
      src.connect(gain).connect(out[e.part])
      src.start(Math.max(t, ctx.currentTime), s.offset)
      src.stop(end + 0.02)
    }
    this.voices.push({ src, gain, start: t, end })
  }

  /** Clears the SP5 counters. */
  resetStats(): void {
    this.stats = freshStats()
    this.drift = { audio: 0, perf: 0 }
  }
}

export const band = new BandEngine()

/** Logged by the SP5 test and every 60 s while the band plays. */
export function statsSummary(s: BandStats): Record<string, number> {
  return {
    min: Math.round((performance.now() - s.startedAt) / 600) / 100,
    ticks: s.ticks,
    gapMaxMs: Math.round(s.gapMaxMs),
    gapsOver50: s.gapsOver50,
    gapsOver100: s.gapsOver100,
    minLeadMs: Number.isFinite(s.minLeadMs) ? Math.round(s.minLeadMs) : -1,
    late: s.late,
    maxLateMs: Math.round(s.maxLateMs * 10) / 10,
    voices: s.voices,
    stalls: s.stalls,
    driftPpm: s.driftPpm,
  }
}

let statsTimer: ReturnType<typeof setInterval> | null = null
band.onJump((e) => {
  if (e.kind === 'play' && statsTimer === null)
    statsTimer = setInterval(() => band.playing && log('info', 'band.stats', statsSummary(band.stats)), 60_000)
})
