import { describe, expect, test } from 'vitest'
import { SpotifyClock, estimateOrigin, type PlayerReading, type PlayerSample } from './SpotifyClock'
import type { JumpEvent } from './types'

const base: PlayerReading = {
  status: 200,
  progressMs: 0,
  isPlaying: true,
  trackId: 'A',
  durationMs: 300_000,
  timestamp: null,
  deviceId: 'dev',
  deviceName: 'PC',
  trackName: null,
  artists: null,
}

/** A sample whose server read happened at perf time `serverAt` while the track was at `pos`. */
function sample(serverAt: number, pos: number, up: number, down: number, extra: Partial<PlayerReading> = {}): PlayerSample {
  return { ...base, progressMs: pos, ...extra, t0: serverAt - up, t1: serverAt + down }
}

function clock(offset = 0) {
  const c = new SpotifyClock({ fetchPlayer: async () => base, now: () => 0, offsetFor: () => offset })
  const jumps: JumpEvent[] = []
  c.onJump((e) => jumps.push(e))
  return { c, jumps }
}

describe('SpotifyClock', () => {
  test('locks on the first sample and interpolates with RTT/2', () => {
    const { c, jumps } = clock()
    c.ingest(sample(1000, 5000, 40, 40))
    expect(jumps.map((j) => j.kind)).toEqual(['lock'])
    expect(c.positionMs(1000)).toBe(5000)
    expect(c.positionMs(3500)).toBe(7500)
  })

  test('prefers low-RTT samples over a slow, asymmetric one', () => {
    const { c } = clock()
    // Truth: origin = 0 (position == perf time).
    c.ingest(sample(10_000, 10_000, 20, 20))
    c.ingest(sample(11_000, 11_000, 25, 25))
    c.ingest(sample(12_000, 12_000, 30, 30))
    // Slow sample: 50 ms up, 350 ms down, so its midpoint is off by 150 ms.
    c.ingest(sample(13_000, 13_000, 50, 350))
    expect(Math.abs(c.positionMs(20_000) - 20_000)).toBeLessThan(1)
  })

  test('detects seeks beyond the threshold but not jitter', () => {
    const { c, jumps } = clock()
    c.ingest(sample(0, 0, 30, 30))
    c.ingest(sample(1000, 1150, 30, 30)) // 150 ms off: jitter, not a seek
    expect(jumps).toHaveLength(1)
    c.ingest(sample(2000, 62_000, 30, 30))
    expect(jumps.at(-1)?.kind).toBe('seek')
    expect(c.positionMs(2500)).toBe(62_500)
  })

  test('pause freezes the position, play resumes from it', () => {
    const { c, jumps } = clock()
    c.ingest(sample(0, 1000, 30, 30))
    c.ingest(sample(1000, 2000, 30, 30, { isPlaying: false }))
    expect(jumps.at(-1)?.kind).toBe('pause')
    expect(c.playing).toBe(false)
    expect(c.positionMs(9000)).toBe(2000)
    c.ingest(sample(10_000, 2000, 30, 30))
    expect(jumps.at(-1)?.kind).toBe('play')
    expect(c.positionMs(10_500)).toBe(2500)
  })

  test('track change and idle', () => {
    const { c, jumps } = clock()
    c.ingest(sample(0, 1000, 30, 30))
    c.ingest(sample(1000, 0, 30, 30, { trackId: 'B' }))
    expect(jumps.at(-1)?.kind).toBe('track')
    expect(c.trackId).toBe('B')
    c.ingest(sample(2000, 0, 30, 30, { status: 204, progressMs: null, trackId: null }))
    expect(jumps.at(-1)?.kind).toBe('idle')
    expect(c.locked).toBe(false)
  })

  test('adds the device offset', () => {
    const { c } = clock(-120)
    c.ingest(sample(1000, 5000, 10, 10))
    expect(c.positionMs(1000)).toBe(4880)
    expect(c.rawPositionMs(1000)).toBe(5000)
  })

  test('polls on a timer: fast after a jump, slow when paused', async () => {
    let t = 0
    const delays: number[] = []
    let readings: PlayerReading[] = [base, { ...base, progressMs: 1000 }, { ...base, isPlaying: false }]
    const c = new SpotifyClock({
      fetchPlayer: async () => {
        const r = readings[0] as PlayerReading
        readings = readings.slice(1).length ? readings.slice(1) : readings
        t += 1000
        return r
      },
      now: () => t,
      setTimer: (_fn, ms) => {
        delays.push(ms)
        return 1
      },
      clearTimer: () => {},
    })
    c.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(delays).toEqual([250])
  })
})

test('estimateOrigin takes the median of the fastest third', () => {
  expect(
    estimateOrigin([
      { origin: 5, rtt: 10 },
      { origin: 100, rtt: 500 },
      { origin: 7, rtt: 12 },
      { origin: -80, rtt: 400 },
      { origin: 6, rtt: 11 },
      { origin: 50, rtt: 300 },
    ]),
  ).toBe(5.5)
})
