import { describe, expect, it } from 'vitest'
import { fitTaps, nearestBeat } from './calibrate'
import { type SyncInput, syncState } from './sync'

const base: SyncInput = {
  authed: true,
  now: 10_000,
  failing: false,
  lastOkAt: 9_800,
  locked: true,
  playing: true,
  quality: { sinceMs: 5000, samples: 6, errMs: 33 },
}

describe('syncState', () => {
  it('locks with an error estimate rounded up to 10 ms', () => {
    expect(syncState(base)).toEqual({ kind: 'locked', ms: 40 })
    expect(syncState({ ...base, quality: { sinceMs: 5000, samples: 6, errMs: 2 } })).toEqual({ kind: 'locked', ms: 10 })
  })
  it('re-syncs right after a jump, and when polls go stale', () => {
    expect(syncState({ ...base, quality: { sinceMs: 300, samples: 1, errMs: 30 } }).kind).toBe('resync')
    expect(syncState({ ...base, lastOkAt: 6_000 }).kind).toBe('resync')
    expect(syncState({ ...base, lastOkAt: null }).kind).toBe('resync')
  })
  it('is paused, idle or offline', () => {
    expect(syncState({ ...base, playing: false }).kind).toBe('paused')
    expect(syncState({ ...base, locked: false }).kind).toBe('idle')
    expect(syncState({ ...base, authed: false }).kind).toBe('offline')
    expect(syncState({ ...base, failing: true, lastOkAt: 1_000 }).kind).toBe('offline')
    // one failed poll is not yet "not connected"
    expect(syncState({ ...base, failing: true }).kind).toBe('locked')
  })
})

describe('fitTaps', () => {
  const beats = Array.from({ length: 200 }, (_, i) => 1000 + i * 500)
  it('finds the nearest beat', () => {
    expect(nearestBeat(beats, 0)).toBe(0)
    expect(nearestBeat(beats, 1240)).toBe(0)
    expect(nearestBeat(beats, 1260)).toBe(1)
    expect(nearestBeat(beats, 1e9)).toBe(199)
  })
  it('needs eight taps after the warm-up', () => {
    const taps = beats.slice(10, 19).map((b) => b + 80)
    const fit = fitTaps(beats, taps)
    expect(fit.used).toBe(7)
    expect(fit.correctionMs).toBeNull()
  })
  it('returns the median correction and spread, ignoring wild taps', () => {
    // chart runs 80 ms ahead of the audio, ±10 ms of human jitter, one tap off the beat
    const jitter = [0, 10, -10, 5, -5, 10, -10, 0, 5, -5, 0, 0]
    const taps = jitter.map((j, i) => beats[20 + i]! + 80 + j)
    taps.push(beats[40]! + 230)
    const fit = fitTaps(beats, taps)
    expect(fit.ignored).toBe(3)
    expect(fit.used).toBe(10)
    expect(fit.correctionMs).toBe(-80)
    expect(fit.spreadMs).toBeLessThanOrEqual(5)
  })
})
