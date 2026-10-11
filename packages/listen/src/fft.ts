// In-place radix-2 FFT and a magnitude spectrum for real frames. Plain typed arrays: it runs in a Worker on the
// phone and in Node for the evaluation, ~0.1 ms for 4096 points.

export class FFT {
  readonly n: number
  private readonly rev: Uint32Array
  private readonly cos: Float64Array
  private readonly sin: Float64Array
  private readonly re: Float64Array
  private readonly im: Float64Array

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`)
    this.n = n
    const bits = Math.log2(n)
    this.rev = new Uint32Array(n)
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.rev[i] = r
    }
    this.cos = new Float64Array(n / 2)
    this.sin = new Float64Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n)
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n)
    }
    this.re = new Float64Array(n)
    this.im = new Float64Array(n)
  }

  /** |X(k)| for k = 0..n/2 of a real frame (already windowed) into `out` (length n/2 + 1). */
  magnitudes(frame: ArrayLike<number>, out: Float32Array): Float32Array {
    const { n, re, im, rev } = this
    for (let i = 0; i < n; i++) {
      re[rev[i]!] = frame[i] ?? 0
      im[rev[i]!] = 0
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const c = this.cos[k * step]!
          const s = this.sin[k * step]!
          const a = start + k
          const b = a + half
          const tr = re[b]! * c - im[b]! * s
          const ti = re[b]! * s + im[b]! * c
          re[b] = re[a]! - tr
          im[b] = im[a]! - ti
          re[a] = re[a]! + tr
          im[a] = im[a]! + ti
        }
      }
    }
    for (let k = 0; k <= n / 2; k++) out[k] = Math.hypot(re[k]!, im[k]!)
    return out
  }
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
  return w
}
