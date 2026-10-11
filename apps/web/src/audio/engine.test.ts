import { TUNES } from '@mq/band'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BandEngine } from './engine'
import type { Kit, Sample } from './kit'
import { onsetOf, sampleMidi } from './kit'

/** Just enough of an AudioContext: a settable clock, and a record of every voice started. */
class FakeCtx {
  currentTime = 10
  starts: Array<{ t: number; buffer: unknown; stopped: boolean }> = []
  destination = {}
  baseLatency = 0.01
  param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} })
  createGain() {
    return { gain: this.param(), connect: (n: unknown) => n, disconnect() {} }
  }
  createDynamicsCompressor() {
    const p = this.param
    return { threshold: p(), knee: p(), ratio: p(), attack: p(), release: p(), connect: (n: unknown) => n }
  }
  createBufferSource() {
    const rec = { t: NaN, buffer: null as unknown, stopped: false }
    return {
      set buffer(b: unknown) {
        rec.buffer = b
      },
      playbackRate: { value: 1 },
      connect: (n: unknown) => n,
      disconnect() {},
      start: (t: number) => {
        rec.t = t
        this.starts.push(rec)
      },
      stop: () => {
        rec.stopped = true
      },
    }
  }
  getOutputTimestamp() {
    // heard = scheduled (no output latency), so positions read straight off the context clock
    return { contextTime: this.currentTime, performanceTime: performance.now() }
  }
}

const sample = (tag: string, midi = 60): Sample => ({ buffer: { duration: 1, tag } as unknown as AudioBuffer, offset: 0, norm: 1, midi })
const kit: Kit = {
  piano: [sample('piano', 60)],
  bass: [sample('bass', 36)],
  drums: Object.fromEntries(
    ['ride', 'bell', 'crash', 'hhfoot', 'hhclosed', 'hhopen', 'kick', 'snare', 'ghost', 'xstick', 'shaker'].map((d) => [d, sample(d)]),
  ) as Kit['drums'],
  bytes: 0,
  ms: 0,
}

const blues = TUNES.find((t) => t.id === 'blues-in-f')!
let ctx: FakeCtx
let e: BandEngine

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  ctx = new FakeCtx()
  e = new BandEngine()
  e.attach(ctx as unknown as AudioContext, kit)
})
afterEach(() => {
  e.pause()
  vi.useRealTimers()
})

/** Moves the audio clock on, letting the scheduler tick every 25 ms. */
function advance(s: number) {
  for (let t = 0; t < s - 1e-9; t += 0.025) {
    ctx.currentTime += 0.025
    vi.advanceTimersByTime(25)
  }
}

const tag = (r: { buffer: unknown }) => (r.buffer as { tag: string }).tag

test('counts in, then starts the form on time; the chart holds at the top during the count-in', () => {
  const tl = e.load(blues, { bpm: 120, style: 'swing', choruses: 1, countIn: 1 })
  expect(tl.source).toBe('exact')
  expect(tl.durationMs).toBe(12 * 4 * 500)
  e.play()
  const t0 = 10 + 0.08
  const clicks = ctx.starts.filter((s) => tag(s) === 'xstick' && s.t < t0 + 2 - 1e-6)
  expect(clicks.map((s) => +(s.t - t0).toFixed(3))).toEqual([0, 0.5, 1, 1.5])
  expect(e.positionMs()).toBe(0)
  advance(1)
  expect(e.countInLeft()).toBe(3) // ~1.08 s into a 2 s count-in: beats 2, 3 and 4 still to come (heard at 10.08 + 1.0)
  expect(e.positionMs()).toBe(0)
  advance(1.5) // 0.42 s into the form
  expect(e.countInLeft()).toBe(0)
  expect(e.positionMs()).toBeCloseTo(420, 0)
  // the form's first bass note lands on the downbeat after the count-in
  const firstBass = ctx.starts.filter((s) => tag(s) === 'bass').sort((a, b) => a.t - b.t)[0]!
  expect(firstBass.t).toBeCloseTo(t0 + 2, 6)
})

test('schedules ahead of the clock and never late', () => {
  e.load(blues, { bpm: 300, style: 'swing', choruses: 2, countIn: 0 })
  e.play()
  advance(10)
  expect(e.stats.late).toBe(0)
  expect(e.stats.minLeadMs).toBeGreaterThan(0)
  expect(Math.max(...ctx.starts.map((s) => s.t))).toBeLessThan(ctx.currentTime + 0.25 + 4 * 0.2 + 1e-6)
})

test('loops exactly on bar lines: the clock and the voices both go back', () => {
  e.load(blues, { bpm: 120, style: 'swing', choruses: 1, countIn: 0 })
  e.setLoop({ startMs: 2000, endMs: 6000 }) // bars 2–3
  e.play()
  e.seek(2000)
  const start = ctx.currentTime + 0.08
  advance(4.5) // past the end of bar 3 (4 s after the seek)
  expect(e.positionMs()).toBeGreaterThan(2000)
  expect(e.positionMs()).toBeLessThan(3000)
  // the next bar 2 downbeat: a bass note 4 s after the seek's start
  expect(ctx.starts.some((s) => tag(s) === 'bass' && Math.abs(s.t - (start + 4)) < 1e-6)).toBe(true)
})

test('a tempo change keeps the place in the form and rescales the timeline', () => {
  e.load(blues, { bpm: 120, style: 'swing', choruses: 1, countIn: 0 })
  e.seek(8000) // beat 16, bar 5
  const tl = e.update({ bpm: 240 })!
  expect(tl.durationMs).toBe(12 * 4 * 250)
  expect(e.positionMs()).toBe(4000) // still beat 16
})

test('pauses at the end of the form and starts over on play', () => {
  e.load(blues, { bpm: 300, style: 'pop', choruses: 1, countIn: 0 })
  e.seek(e.durationMs - 300)
  e.play()
  advance(0.5)
  expect(e.checkEnd()).toBe(true)
  expect(e.playing).toBe(false)
  e.play()
  expect(e.positionMs()).toBe(0)
})

test('pause stops every voice not yet started', () => {
  e.load(blues, { bpm: 120, style: 'swing', choruses: 1, countIn: 0 })
  e.play()
  advance(0.3)
  e.pause()
  const future = ctx.starts.filter((s) => s.t > ctx.currentTime)
  expect(future.length).toBeGreaterThan(0)
  expect(future.every((s) => s.stopped)).toBe(true)
})

test('sample names and onsets', () => {
  expect(sampleMidi('C4')).toBe(60)
  expect(sampleMidi('Ds2')).toBe(39)
  expect(sampleMidi('bb1')).toBe(34)
  expect(sampleMidi('A1')).toBe(33)
  const data = new Float32Array(1000)
  data[441] = 0.5
  data[600] = -1
  const o = onsetOf(data, 44100)
  expect(o.peak).toBe(1)
  expect(o.offset).toBeCloseTo(441 / 44100 - 0.002, 6)
})
