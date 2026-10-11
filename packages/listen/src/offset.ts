// Timing offsets for listening (M7, SP7 follow-up: the iPhone's saved chords were ~2.5 s late, D-70). Two delays sit
// between the music and a mic sample's track time, and each is measured on its own:
//  - the phone's mic path: an echo test plays `chirp()` from the phone and `findEcho()` finds it in the mic input, so
//    the round trip (output frame → input frame) is known and taken off every anchor;
//  - the speaker's lag behind Spotify's report: what the mic hears on an analysed track, shifted by `bestShift()`
//    onto the analysis, is that speaker's offset (D-51's tap-along, done by ear instead of by hand).
import { scoreBeats, type Span } from './score'

/** A linear sweep from `f0` to `f1` Hz, Hann-tapered: sharp to correlate and easy to tell from music. */
export function chirp(sampleRate: number, ms = 30, f0 = 1000, f1 = 4000): Float32Array {
  const n = Math.round((sampleRate * ms) / 1000)
  const out = new Float32Array(n)
  const dur = n / sampleRate
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const phase = 2 * Math.PI * (f0 * t + ((f1 - f0) * t * t) / (2 * dur))
    out[i] = Math.sin(phase) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))
  }
  return out
}

export interface Echo {
  /** samples from the start of `rec` to the probe's arrival */
  lag: number
  /** normalised correlation at the peak (0..1) */
  peak: number
  /** best normalised correlation more than 10 ms away from the peak */
  runnerUp: number
}

/** Where `probe` arrives in `rec` (normalised cross-correlation), or null if it is not clearly there. */
export function findEcho(rec: Float32Array, probe: Float32Array, sampleRate: number): Echo | null {
  const m = probe.length
  const lags = rec.length - m + 1
  if (lags <= 0) return null
  let pe = 0
  for (let j = 0; j < m; j++) pe += probe[j]! * probe[j]!
  // prefix sums of rec² for the window energy at each lag
  const sq = new Float64Array(rec.length + 1)
  for (let i = 0; i < rec.length; i++) sq[i + 1] = sq[i]! + rec[i]! * rec[i]!
  const ncc = (lag: number): number => {
    let s = 0
    for (let j = 0; j < m; j++) s += rec[lag + j]! * probe[j]!
    const we = sq[lag + m]! - sq[lag]!
    return we > 0 ? Math.abs(s) / Math.sqrt(pe * we) : 0
  }
  // coarse pass every 4 samples (the peak of a 1–4 kHz sweep is ~16 samples wide at 48 kHz), then refine
  const stride = Math.max(1, Math.floor(sampleRate / 12000))
  const coarse = new Float32Array(Math.ceil(lags / stride))
  let best = 0
  for (let k = 0; k < coarse.length; k++) {
    coarse[k] = ncc(k * stride)
    if (coarse[k]! > coarse[best]!) best = k
  }
  let lag = best * stride
  let peak = coarse[best]!
  for (let l = Math.max(0, lag - stride); l <= Math.min(lags - 1, lag + stride); l++) {
    const v = ncc(l)
    if (v > peak) {
      peak = v
      lag = l
    }
  }
  const away = Math.round(sampleRate / 100)
  let runnerUp = 0
  for (let k = 0; k < coarse.length; k++) if (Math.abs(k * stride - lag) > away && coarse[k]! > runnerUp) runnerUp = coarse[k]!
  if (peak < 0.15 || peak < 1.5 * runnerUp) return null
  return { lag, peak, runnerUp }
}

export interface Shift {
  /** ms to add to the estimate's times to match the truth */
  shiftMs: number
  majmin: number
  /** majmin as stamped (shift 0) */
  at0: number
  beats: number
  /** best majmin more than 600 ms from the best shift: a song's repeats make other shifts score too */
  runnerUp: number
}

/** The time shift within ±`rangeMs` at which `est` scores best (majmin per truth beat over est's span). */
export function bestShift(truth: Span[], truthBeats: number[], est: Span[], rangeMs = 5000, stepMs = 50): Shift | null {
  if (est.length < 2) return null
  const score = (shift: number) => {
    const a = est[0]!.startMs + shift
    const b = est[est.length - 1]!.endMs + shift
    const moved = est.map((c) => ({ ...c, startMs: c.startMs + shift, endMs: c.endMs + shift }))
    return scoreBeats(truth, truthBeats.filter((t) => t >= a && t <= b), moved)
  }
  const at0 = score(0)
  if (at0.beats === 0) return null
  const all: Array<{ shift: number; majmin: number }> = []
  for (let sh = -rangeMs; sh <= rangeMs; sh += stepMs) all.push({ shift: sh, majmin: score(sh).majmin })
  // per-beat scoring is flat for up to a beat around the right shift: take the middle of the best plateau
  let i = 0
  for (let k = 1; k < all.length; k++) if (all[k]!.majmin > all[i]!.majmin) i = k
  let j = i
  while (j + 1 < all.length && all[j + 1]!.majmin >= all[i]!.majmin - 1e-9) j++
  const top = { shift: all[(i + j) >> 1]!.shift, majmin: all[i]!.majmin }
  const runnerUp = Math.max(0, ...all.filter((x) => Math.abs(x.shift - top.shift) > 600).map((x) => x.majmin))
  return { shiftMs: top.shift, majmin: top.majmin, at0: at0.majmin, beats: at0.beats, runnerUp }
}
