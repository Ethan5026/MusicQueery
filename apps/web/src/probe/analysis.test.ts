import { describe, expect, test } from 'vitest'
import { DriftAnalyzer, circularMedian, quantile, wrap } from './analysis'

const P = 500

test('wrap and circular median handle the ±P/2 seam', () => {
  expect(wrap(260, P)).toBe(-240)
  expect(wrap(-260, P)).toBe(240)
  expect(wrap(1000, P)).toBe(0)
  expect(wrap(circularMedian([245, 248, -249, -246, 250], P) - 250, P)).toBeCloseTo(0, 5)
  expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
})

/** Clicks every P ms of track time starting at click offset c; clock error e(t) added to position. */
function run(
  a: DriftAnalyzer,
  fromAt: number,
  toAt: number,
  opts: { trackOffset?: number; c?: number; err?: (at: number) => number; playing?: boolean; trackId?: string } = {},
) {
  const { trackOffset = 0, c = 37, err = () => 0, playing = true, trackId = 'T' } = opts
  // Click at perf time `at` is at track position (at - fromAt + trackOffset); grid k·P + c.
  const first = Math.ceil((trackOffset - c) / P) * P + c - trackOffset + fromAt
  for (let at = first; at < toAt; at += P) {
    a.addOnset({ at, level: 1 }, { trackId, playing, posMs: at - fromAt + trackOffset + err(at) + 20 })
  }
}

describe('DriftAnalyzer', () => {
  test('a perfect clock measures zero drift after calibration', () => {
    const a = new DriftAnalyzer({ periodMs: P })
    run(a, 0, 600_000)
    const s = a.summary()
    expect(s.calibrated).toBe(true)
    expect(s.medianAbsMs).toBeCloseTo(0, 6)
    expect(s.p95AbsMs).toBeCloseTo(0, 6)
    expect(s.measuredForMs).toBeGreaterThan(570_000)
    expect(s.periodPpm).toBeCloseTo(0, 3)
    expect(s.episodes).toEqual([])
  })

  test('a slowly drifting clock shows up in the stats and the slope', () => {
    const a = new DriftAnalyzer({ periodMs: P })
    run(a, 0, 600_000, { err: (at) => (at / 60_000) * 10 }) // +10 ms per minute
    const s = a.summary()
    expect(s.slopeMsPerMin).toBeCloseTo(10, 1)
    expect(s.maxAbsMs).toBeGreaterThan(90)
  })

  test('noise clicks off the grid are rejected', () => {
    const a = new DriftAnalyzer({ periodMs: P })
    run(a, 0, 30_000)
    a.addOnset({ at: 30_123, level: 1 }, { trackId: 'T', playing: true, posMs: 30_123 })
    expect(a.summary().rejected).toBe(1)
  })

  test('a seek is a re-lock episode, timed from the last good click', () => {
    const a = new DriftAnalyzer({ periodMs: P })
    run(a, 0, 60_000)
    // At 60 s the user seeks to 120.2 s; the clock notices at 61.1 s.
    run(a, 60_000, 61_100, { trackOffset: 120_200, err: () => 60_000 - 120_200 })
    a.addJump('seek', 61_100)
    run(a, 61_100, 70_000, { trackOffset: 120_200 + 1100 })
    const s = a.summary()
    expect(s.episodes).toHaveLength(1)
    const e = s.episodes[0]!
    expect(e.kind).toBe('seek')
    expect(e.relockMs).toBeGreaterThan(1000)
    expect(e.relockMs).toBeLessThan(1700)
    expect(s.medianAbsMs).toBeCloseTo(0, 6)
  })

  test('resume after a pause: clicks while the clock still says paused', () => {
    const a = new DriftAnalyzer({ periodMs: P })
    run(a, 0, 40_000)
    a.addJump('pause', 41_000)
    // Silence 40–50 s. Audio resumes at 50 s; the clock says paused until 50.8 s.
    run(a, 50_000, 50_800, { trackOffset: 40_000, playing: false })
    a.addJump('play', 50_800)
    run(a, 50_800, 60_000, { trackOffset: 40_800 })
    const e = a.summary().episodes[0]!
    expect(e.kind).toBe('play')
    expect(e.relockMs).toBeLessThanOrEqual(1500)
    expect(e.relockMs).toBeGreaterThanOrEqual(800)
  })

  test('a skip ends when the clock sees the new track, which then calibrates', () => {
    const a = new DriftAnalyzer({ periodMs: P })
    run(a, 0, 30_000)
    run(a, 30_000, 30_900, { trackOffset: 29_000, c: 250, err: () => 1000 }) // new audio, clock still on old track
    a.addJump('track', 30_900)
    run(a, 30_900, 50_000, { trackId: 'U', c: 250, trackOffset: 900 })
    const s = a.summary()
    expect(s.episodes.map((e) => e.kind)).toEqual(['track'])
    expect(s.episodes[0]!.relockMs).toBeLessThan(1500)
    expect(s.medianAbsMs).toBeCloseTo(0, 6)
  })
})
