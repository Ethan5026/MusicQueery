// Tap-along calibration (02-dev-plan: per-output-device offset). While an analysed track plays, the user taps
// on every beat they hear. Each tap is compared with the nearest beat of the timeline at the clock's position;
// the median difference is how far the chart runs ahead of (or behind) this speaker.

export interface TapFit {
  /** taps used (near a beat, after the warm-up) */
  used: number
  /** taps ignored: warm-up or more than a third of a beat from any beat */
  ignored: number
  /** ms to add to the device offset (positive = the chart was behind the audio) */
  correctionMs: number | null
  /** half the interquartile range of the tap errors (ms): how steady the taps were */
  spreadMs: number | null
}

export const WARMUP_TAPS = 2
export const MIN_TAPS = 8
export const MAX_TAPS = 24

/** Index of the beat nearest to `ms` in ascending `beats`. */
export function nearestBeat(beats: number[], ms: number): number {
  let lo = 0
  let hi = beats.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (beats[mid]! <= ms) lo = mid
    else hi = mid
  }
  return Math.abs(beats[lo]! - ms) <= Math.abs(beats[hi]! - ms) ? lo : hi
}

const quantile = (sorted: number[], q: number): number => {
  const x = (sorted.length - 1) * q
  const i = Math.floor(x)
  return sorted[i]! + (sorted[Math.min(i + 1, sorted.length - 1)]! - sorted[i]!) * (x - i)
}

/** `taps` are chart positions (ms, offset included) at the moments the user tapped. */
export function fitTaps(beats: number[], taps: number[]): TapFit {
  const errs: number[] = []
  let ignored = 0
  taps.forEach((p, i) => {
    if (i < WARMUP_TAPS || beats.length < 2) return void ignored++
    const k = nearestBeat(beats, p)
    const period = (beats[Math.min(k + 1, beats.length - 1)]! - beats[Math.max(k - 1, 0)]!) / 2
    const d = beats[k]! - p
    if (Math.abs(d) > period / 3) return void ignored++
    errs.push(d)
  })
  const recent = errs.slice(-MAX_TAPS).sort((a, b) => a - b)
  if (recent.length < MIN_TAPS) return { used: recent.length, ignored, correctionMs: null, spreadMs: null }
  return {
    used: recent.length,
    ignored,
    correctionMs: Math.round(quantile(recent, 0.5)),
    spreadMs: Math.round((quantile(recent, 0.75) - quantile(recent, 0.25)) / 2),
  }
}
