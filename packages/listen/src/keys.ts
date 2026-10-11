// Running key estimate from treble chroma (Krumhansl–Kessler profiles), as weights over the 12 major tonics
// (a minor key counts towards its relative major, since the chord prior only needs the diatonic set).

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function corr(a: ArrayLike<number>, profile: number[], shift: number): number {
  let ma = 0
  let mp = 0
  for (let i = 0; i < 12; i++) {
    ma += a[i]!
    mp += profile[i]!
  }
  ma /= 12
  mp /= 12
  let num = 0
  let da = 0
  let dp = 0
  for (let i = 0; i < 12; i++) {
    const x = a[(i + shift) % 12]! - ma
    const y = profile[i]! - mp
    num += x * y
    da += x * x
    dp += y * y
  }
  return da > 0 ? num / Math.sqrt(da * dp) : 0
}

/** Softmax weights over the 12 major tonics for a chroma profile; `sharpness` scales the correlations. */
export function keyWeights(chroma: ArrayLike<number>, sharpness = 12): Float32Array {
  const score = new Float32Array(12)
  for (let k = 0; k < 12; k++) {
    // relative minor of major k is k + 9
    score[k] = Math.max(corr(chroma, KK_MAJOR, k), corr(chroma, KK_MINOR, (k + 9) % 12))
  }
  let max = -Infinity
  for (const s of score) max = Math.max(max, s)
  let sum = 0
  for (let k = 0; k < 12; k++) {
    score[k] = Math.exp(sharpness * (score[k]! - max))
    sum += score[k]!
  }
  for (let k = 0; k < 12; k++) score[k]! /= sum
  return score
}
