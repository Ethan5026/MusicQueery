// Repeats in a song from beat chroma: a self-similarity matrix of beats, smoothed along its diagonals, gives
// for each beat the earlier (and later) beats that play the same music. Used three ways (M7):
//  - chorus consensus: a beat's chord evidence is averaged with its repeats' before decoding (structural
//    smoothing, after Mauch, Noland & Dixon 2009), so a chord heard clearly once helps every chorus;
//  - Predicted: live, what followed the earlier repeats of the last bars is what comes next (D-04);
//  - sections: runs of beats that repeat elsewhere get letters (P-05).
import type { BeatFeature } from './chords'

export interface RepeatOptions {
  /** beats averaged along a diagonal */
  window?: number
  /** shortest lag (beats) that counts as a repeat */
  minLag?: number
  /** smoothed diagonal similarity a repeat needs */
  threshold?: number
}

export const DEFAULT_REPEAT: Required<RepeatOptions> = { window: 16, minLag: 8, threshold: 0.8 }

/** Unit 24-d vectors (bass + treble, each unit, weighted equally). */
export function beatVectors(feats: BeatFeature[]): Float32Array[] {
  return feats.map((f) => {
    const v = new Float32Array(24)
    const bn = Math.hypot(...f.bass)
    const tn = Math.hypot(...f.treble)
    for (let i = 0; i < 12; i++) {
      v[i] = bn > 0 ? f.bass[i]! / bn : 0
      v[12 + i] = tn > 0 ? f.treble[i]! / tn : 0
    }
    const n = Math.hypot(...v)
    if (n > 0) for (let i = 0; i < 24; i++) v[i]! /= n
    return v
  })
}

const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

/**
 * For every beat i, the beats j < i that repeat it (lag i − j ≥ minLag), with the smoothed diagonal similarity.
 * The diagonal is averaged over a window centred on (i, j), so the match covers the music around the beat.
 */
export function findRepeats(vecs: Float32Array[], o: RepeatOptions = {}): { j: number; sim: number }[][] {
  const { window, minLag, threshold } = { ...DEFAULT_REPEAT, ...o }
  const n = vecs.length
  const out: { j: number; sim: number }[][] = Array.from({ length: n }, () => [])
  const half = window >> 1
  for (let lag = minLag; lag < n; lag++) {
    const len = n - lag
    const d = new Float32Array(len)
    for (let k = 0; k < len; k++) d[k] = dot(vecs[k + lag]!, vecs[k]!)
    // centred moving average
    const pre = new Float64Array(len + 1)
    for (let k = 0; k < len; k++) pre[k + 1] = pre[k]! + d[k]!
    for (let k = 0; k < len; k++) {
      const a = Math.max(0, k - half)
      const b = Math.min(len, k + half)
      const m = (pre[b]! - pre[a]!) / (b - a)
      if (m >= threshold) out[k + lag]!.push({ j: k, sim: m })
    }
  }
  return out
}

/**
 * Averages each beat's log-likelihoods with those of its repeats (both directions), weighted by similarity.
 * `selfWeight` keeps the beat's own evidence ahead of any single repeat.
 */
export function consensus(ll: Float32Array[], repeats: { j: number; sim: number }[][], selfWeight = 1.5): Float32Array[] {
  const n = ll.length
  const S = ll[0]?.length ?? 0
  const links: { j: number; w: number }[][] = Array.from({ length: n }, () => [])
  repeats.forEach((rs, i) => {
    for (const { j, sim } of rs) {
      links[i]!.push({ j, w: sim })
      links[j]!.push({ j: i, w: sim })
    }
  })
  return ll.map((own, i) => {
    const ls = links[i]!
    if (!ls.length) return own
    const acc = new Float32Array(S)
    let wsum = selfWeight
    for (let s = 0; s < S; s++) acc[s] = own[s]! * selfWeight
    for (const { j, w } of ls) {
      const o = ll[j]!
      for (let s = 0; s < S; s++) acc[s]! += o[s]! * w
      wsum += w
    }
    for (let s = 0; s < S; s++) acc[s]! /= wsum
    return acc
  })
}
