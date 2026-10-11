// A rough "played over speakers, heard by the phone" channel for the offline evaluation (SP7 before the phone):
// TV-speaker band-pass (high-pass 110 Hz, low-pass 10 kHz), a Schroeder/Freeverb room (RT60 ~0.5 s, 35% wet),
// the mic's own high-pass (70 Hz), a level ~25 dB below full scale and pink noise 30 dB under the music.
// It is not a substitute for the real test on the iPhone; it keeps the decoder honest about weak bass and reverb.

export interface RoomOptions {
  seed?: number
  snrDb?: number
  wet?: number
  speakerHpHz?: number
}

class Biquad {
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0
  constructor(
    private b0: number,
    private b1: number,
    private b2: number,
    private a1: number,
    private a2: number,
  ) {}
  static highpass(sr: number, f: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * f) / sr
    const al = Math.sin(w) / (2 * q)
    const c = Math.cos(w)
    const a0 = 1 + al
    return new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0)
  }
  static lowpass(sr: number, f: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * f) / sr
    const al = Math.sin(w) / (2 * q)
    const c = Math.cos(w)
    const a0 = 1 + al
    return new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0)
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) / 4294967296) * 2 - 1
  }
}

export function simulateRoom(input: Float32Array, sr: number, o: RoomOptions = {}): Float32Array {
  const n = input.length
  const out = new Float32Array(n)
  // speaker
  const hp1 = Biquad.highpass(sr, o.speakerHpHz ?? 110)
  const hp2 = Biquad.highpass(sr, o.speakerHpHz ?? 110)
  const lp = Biquad.lowpass(sr, 10000)
  for (let i = 0; i < n; i++) out[i] = lp.run(hp2.run(hp1.run(input[i]!)))
  // room: 4 parallel damped combs + 2 allpasses (Freeverb tunings scaled to sr)
  const scale = sr / 44100
  const combs = [1116, 1188, 1277, 1356].map((d) => ({ buf: new Float32Array(Math.round(d * scale * 1.6)), i: 0, store: 0 }))
  const aps = [556, 441].map((d) => ({ buf: new Float32Array(Math.round(d * scale)), i: 0 }))
  const feedback = 0.8
  const damp = 0.3
  const wet = o.wet ?? 0.35
  for (let i = 0; i < n; i++) {
    const x = out[i]!
    let acc = 0
    for (const c of combs) {
      const y = c.buf[c.i]!
      c.store = y * (1 - damp) + c.store * damp
      c.buf[c.i] = x * 0.25 + c.store * feedback
      c.i = (c.i + 1) % c.buf.length
      acc += y
    }
    for (const a of aps) {
      const b = a.buf[a.i]!
      const y = -acc + b
      a.buf[a.i] = acc + b * 0.5
      a.i = (a.i + 1) % a.buf.length
      acc = y
    }
    out[i] = x * (1 - wet) + acc * wet
  }
  // mic high-pass and level
  const mic = Biquad.highpass(sr, 70)
  let ss = 0
  for (let i = 0; i < n; i++) {
    out[i] = mic.run(out[i]!)
    ss += out[i]! * out[i]!
  }
  const rms = Math.sqrt(ss / Math.max(1, n))
  const target = 10 ** (-25 / 20)
  const g = rms > 0 ? target / rms : 1
  // pink noise (Paul Kellet's economy filter)
  const r = rng(o.seed ?? 1)
  const noiseRms = target * 10 ** (-(o.snrDb ?? 30) / 20)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  for (let i = 0; i < n; i++) {
    const w = r()
    b0 = 0.99765 * b0 + w * 0.099046
    b1 = 0.963 * b1 + w * 0.2965164
    b2 = 0.57 * b2 + w * 1.0526913
    const pink = (b0 + b1 + b2 + w * 0.1848) * 0.11
    out[i] = out[i]! * g + pink * noiseRms * 3
  }
  return out
}
