// Audio → chroma frames, after Chordino / NNLS-Chroma (Mauch & Dixon 2010), made streaming so the phone can run
// it on the mic as samples arrive (M7, SP7):
//   decimate to ~11 kHz → 4096-point STFT (hop 512, ~46 ms) → log-frequency spectrum, 3 bins a semitone, A1–C7
//   → tuning from the 3-bin phase (running) → semitone spectrum → spectral whitening (running mean/std over an
//   octave) → note activations by non-negative least squares against harmonic note profiles → bass and treble chroma.
// It also emits an onset-strength envelope at ~86 Hz for the beat tracker (spectral flux of a short STFT).

import { FFT, hann } from './fft'

export const MIDI_LO = 33 // A1, 55 Hz
export const MIDI_HI = 96 // C7
export const NOTES = MIDI_HI - MIDI_LO + 1

export interface ChromaFrame {
  /** seconds since the stream started, at the frame's centre (decimation delay taken off) */
  t: number
  bass: Float32Array
  treble: Float32Array
  /** note activations MIDI_LO..MIDI_HI (NNLS, or the whitened semitone spectrum when nnls is off) */
  notes: Float32Array
  /** frame level in dBFS (RMS of the decimated signal) */
  db: number
}

export interface OnsetFrame {
  t: number
  /** spectral flux, log-compressed, not normalised */
  value: number
}

export interface FrontendOptions {
  sampleRate: number
  fftSize?: number
  hop?: number
  /** NNLS note transcription (default on); off = whitened semitone spectrum folded straight into chroma */
  nnls?: boolean
  /** harmonic amplitude decay of the NNLS note profiles (Chordino: 0.7) */
  decay?: number
  /** fixed tuning in semitones; default is a running estimate */
  tuning?: number
}

const ONSET_N = 512
const ONSET_HOP = 128

export class Frontend {
  readonly sr: number
  readonly factor: number
  readonly n: number
  readonly hop: number
  tuning = 0
  private readonly fixedTuning: number | null
  private readonly nnls: boolean
  // decimator
  private readonly fir: Float32Array
  private readonly hist: Float32Array
  private histPos = 0
  private phase = 0
  private readonly delay: number
  // decimated ring buffer
  private readonly buf: Float32Array
  private written = 0
  private nextFrame: number
  private nextOnset: number
  // spectra
  private readonly fft: FFT
  private readonly win: Float32Array
  private readonly frame: Float32Array
  private readonly mag: Float32Array
  private readonly kernel: { lo: number; w: Float32Array }[]
  private readonly sub: Float32Array
  private tunRe = 0
  private tunIm = 0
  private readonly semi = new Float32Array(NOTES)
  private readonly white = new Float32Array(NOTES)
  private readonly dict: Float32Array // NOTES × NOTES, column j = profile of note j
  private readonly dtd: Float32Array
  private act = new Float32Array(NOTES)
  private readonly bassW: Float32Array
  private readonly trebleW: Float32Array
  // onsets
  private readonly offt: FFT
  private readonly owin: Float32Array
  private readonly oframe: Float32Array
  private readonly omag: Float32Array
  private prevLog: Float32Array
  private readonly obands: number

  constructor(opts: FrontendOptions) {
    this.factor = Math.max(1, Math.round(opts.sampleRate / 11025))
    this.sr = opts.sampleRate / this.factor
    this.n = opts.fftSize ?? 4096
    this.hop = opts.hop ?? 512
    this.nnls = opts.nnls ?? true
    this.fixedTuning = opts.tuning ?? null
    if (this.fixedTuning !== null) this.tuning = this.fixedTuning
    this.fir = lowpass(this.factor)
    this.hist = new Float32Array(this.fir.length * 2)
    this.delay = (this.fir.length - 1) / 2 / opts.sampleRate
    this.buf = new Float32Array(this.n * 2)
    this.nextFrame = this.n
    this.nextOnset = ONSET_N
    this.fft = new FFT(this.n)
    this.win = hann(this.n)
    this.frame = new Float32Array(this.n)
    this.mag = new Float32Array(this.n / 2 + 1)
    this.kernel = logKernel(this.sr, this.n)
    this.sub = new Float32Array(this.kernel.length)
    this.dict = noteDictionary(opts.decay ?? 0.7)
    this.dtd = gram(this.dict)
    this.bassW = new Float32Array(NOTES)
    this.trebleW = new Float32Array(NOTES)
    for (let j = 0; j < NOTES; j++) {
      const m = MIDI_LO + j
      this.bassW[j] = m <= 36 ? (m - 32) / 4 : m <= 52 ? 1 : m < 60 ? (60 - m) / 8 : 0
      this.trebleW[j] = m < 45 ? 0 : m < 52 ? (m - 44) / 8 : m <= 84 ? 1 : (MIDI_HI + 1 - m) / (MIDI_HI + 1 - 84)
    }
    this.offt = new FFT(ONSET_N)
    this.owin = hann(ONSET_N)
    this.oframe = new Float32Array(ONSET_N)
    this.omag = new Float32Array(ONSET_N / 2 + 1)
    this.obands = ONSET_N / 2
    this.prevLog = new Float32Array(this.obands + 1)
  }

  /** Feeds samples at the input rate; returns the chroma and onset frames completed by them. */
  push(input: ArrayLike<number>, onChroma: (f: ChromaFrame) => void, onOnset?: (f: OnsetFrame) => void): void {
    const { fir, hist, factor } = this
    const L = fir.length
    for (let i = 0; i < input.length; i++) {
      const x = input[i]!
      hist[this.histPos] = x
      hist[this.histPos + L] = x
      this.histPos = (this.histPos + 1) % L
      if (++this.phase < factor) continue
      this.phase = 0
      let y = 0
      // hist[histPos .. histPos+L) is the last L samples, oldest first
      for (let k = 0; k < L; k++) y += fir[k]! * hist[this.histPos + k]!
      this.buf[this.written % this.buf.length] = y
      this.written++
      if (onOnset && this.written >= this.nextOnset) {
        onOnset(this.onset())
        this.nextOnset += ONSET_HOP
      }
      if (this.written >= this.nextFrame) {
        onChroma(this.chroma())
        this.nextFrame += this.hop
      }
    }
  }

  private copyFrame(out: Float32Array, n: number, win: Float32Array): number {
    const start = this.written - n
    let ss = 0
    for (let i = 0; i < n; i++) {
      const v = this.buf[(start + i) % this.buf.length]!
      ss += v * v
      out[i] = v * win[i]!
    }
    return ss / n
  }

  private frameTime(n: number): number {
    return (this.written - n / 2) / this.sr - this.delay
  }

  private onset(): OnsetFrame {
    this.copyFrame(this.oframe, ONSET_N, this.owin)
    this.offt.magnitudes(this.oframe, this.omag)
    let flux = 0
    // 30 Hz .. Nyquist, log-compressed magnitude, half-wave rectified difference
    const k0 = Math.max(1, Math.round((30 * ONSET_N) / this.sr))
    for (let k = k0; k <= this.obands; k++) {
      const v = Math.log1p(100 * this.omag[k]!)
      const d = v - this.prevLog[k]!
      if (d > 0) flux += d
      this.prevLog[k] = v
    }
    return { t: this.frameTime(ONSET_N), value: flux }
  }

  private chroma(): ChromaFrame {
    const ms = this.copyFrame(this.frame, this.n, this.win)
    const db = 10 * Math.log10(ms + 1e-12)
    this.fft.magnitudes(this.frame, this.mag)
    // log-frequency spectrum
    const { kernel, sub, mag } = this
    for (let k = 0; k < kernel.length; k++) {
      const { lo, w } = kernel[k]!
      let s = 0
      for (let i = 0; i < w.length; i++) s += w[i]! * mag[lo + i]!
      sub[k] = s
    }
    // tuning: phase of the energy over the 3 bins of each semitone (bin 3j+1 is the semitone at A440)
    if (this.fixedTuning === null) {
      let re = 0
      let im = 0
      for (let k = 0; k < sub.length; k++) {
        const a = (2 * Math.PI * (k - 1)) / 3
        re += sub[k]! * Math.cos(a)
        im += sub[k]! * Math.sin(a)
      }
      // ~10 s memory
      this.tunRe = this.tunRe * 0.995 + re
      this.tunIm = this.tunIm * 0.995 + im
      this.tuning = Math.atan2(this.tunIm, this.tunRe) / (2 * Math.PI)
    }
    const { semi, white } = this
    for (let j = 0; j < NOTES; j++) {
      const x = 1 + 3 * j + 3 * this.tuning
      const i = Math.floor(x)
      const f = x - i
      semi[j] = (sub[Math.max(0, Math.min(sub.length - 1, i))] ?? 0) * (1 - f) + (sub[Math.min(sub.length - 1, i + 1)] ?? 0) * f
    }
    // whitening: subtract the running mean over an octave, divide by the running std
    for (let j = 0; j < NOTES; j++) {
      const a = Math.max(0, j - 6)
      const b = Math.min(NOTES - 1, j + 6)
      let s = 0
      let s2 = 0
      for (let i = a; i <= b; i++) {
        s += semi[i]!
        s2 += semi[i]! * semi[i]!
      }
      const n = b - a + 1
      const mean = s / n
      const sd = Math.sqrt(Math.max(1e-12, s2 / n - mean * mean))
      white[j] = Math.max(0, (semi[j]! - mean) / sd)
    }
    const notes = this.nnls ? this.solve(white) : Float32Array.from(white)
    const bass = new Float32Array(12)
    const treble = new Float32Array(12)
    for (let j = 0; j < NOTES; j++) {
      const p = (MIDI_LO + j) % 12
      bass[p]! += notes[j]! * this.bassW[j]!
      treble[p]! += notes[j]! * this.trebleW[j]!
    }
    return { t: this.frameTime(this.n), bass, treble, notes, db }
  }

  /** Non-negative least squares by multiplicative updates, warm-started from the previous frame. */
  private solve(y: Float32Array): Float32Array {
    const { dict, dtd } = this
    const dty = new Float32Array(NOTES)
    let any = 0
    for (let j = 0; j < NOTES; j++) {
      let s = 0
      for (let i = 0; i < NOTES; i++) s += dict[i * NOTES + j]! * y[i]!
      dty[j] = s
      any += s
    }
    const a = this.act
    if (any <= 0) {
      a.fill(0)
      return new Float32Array(NOTES)
    }
    for (let j = 0; j < NOTES; j++) if (!(a[j]! > 1e-6)) a[j] = dty[j]! * 0.1 + 1e-4
    const g = new Float32Array(NOTES)
    for (let it = 0; it < 25; it++) {
      for (let j = 0; j < NOTES; j++) {
        let s = 0
        for (let i = 0; i < NOTES; i++) s += dtd[j * NOTES + i]! * a[i]!
        g[j] = s
      }
      for (let j = 0; j < NOTES; j++) a[j] = (a[j]! * dty[j]!) / (g[j]! + 1e-9)
    }
    return Float32Array.from(a)
  }
}

/** Windowed-sinc low-pass for decimation by `factor` (cut-off at 90% of the new Nyquist). */
function lowpass(factor: number): Float32Array {
  if (factor === 1) return Float32Array.of(1)
  const L = 16 * factor + 1
  const fc = 0.45 / factor
  const h = new Float32Array(L)
  let sum = 0
  for (let i = 0; i < L; i++) {
    const m = i - (L - 1) / 2
    const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m)
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (L - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (L - 1))
    h[i] = sinc * w
    sum += h[i]!
  }
  for (let i = 0; i < L; i++) h[i]! /= sum
  return h
}

/** Triangular kernels from FFT bins to log-frequency bins (3 a semitone, bin 3j+1 = MIDI_LO + j at A440). */
function logKernel(sr: number, n: number): { lo: number; w: Float32Array }[] {
  const df = sr / n
  const out: { lo: number; w: Float32Array }[] = []
  const count = NOTES * 3
  for (let k = 0; k < count; k++) {
    const midi = MIDI_LO + (k - 1) / 3
    const f = 440 * 2 ** ((midi - 69) / 12)
    const half = Math.max(df, f * (2 ** (1 / 36) - 1))
    const lo = Math.max(1, Math.floor((f - half) / df))
    const hi = Math.min(n / 2, Math.ceil((f + half) / df))
    const w = new Float32Array(hi - lo + 1)
    let s = 0
    for (let b = lo; b <= hi; b++) {
      const v = Math.max(0, 1 - Math.abs(b * df - f) / half)
      w[b - lo] = v
      s += v
    }
    if (s > 0) for (let i = 0; i < w.length; i++) w[i]! /= s
    out.push({ lo, w })
  }
  return out
}

/** Harmonic note profiles on the semitone grid: partial h at +12·log2(h) semitones with amplitude decay^(h−1). */
function noteDictionary(decay: number): Float32Array {
  const d = new Float32Array(NOTES * NOTES)
  for (let j = 0; j < NOTES; j++) {
    let norm = 0
    for (let h = 1; h <= 20; h++) {
      const pos = j + 12 * Math.log2(h)
      if (pos > NOTES - 1) break
      const i = Math.floor(pos)
      const f = pos - i
      const amp = decay ** (h - 1)
      d[i * NOTES + j]! += amp * (1 - f)
      if (f > 0 && i + 1 < NOTES) d[(i + 1) * NOTES + j]! += amp * f
    }
    for (let i = 0; i < NOTES; i++) norm += d[i * NOTES + j]! ** 2
    norm = Math.sqrt(norm)
    for (let i = 0; i < NOTES; i++) d[i * NOTES + j]! /= norm
  }
  return d
}

function gram(d: Float32Array): Float32Array {
  const g = new Float32Array(NOTES * NOTES)
  for (let a = 0; a < NOTES; a++)
    for (let b = 0; b < NOTES; b++) {
      let s = 0
      for (let i = 0; i < NOTES; i++) s += d[i * NOTES + a]! * d[i * NOTES + b]!
      g[a * NOTES + b] = s
    }
  return g
}
