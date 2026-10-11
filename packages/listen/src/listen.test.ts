import { Timeline } from '@mq/model'
import { describe, expect, test } from 'vitest'
import { BeatTracker, beatF } from './beats'
import { STATES, stateOfSymbol, stateText } from './chords'
import { FFT, hann } from './fft'
import { Frontend } from './frontend'
import { LiveDecoder } from './live'
import { decodeOffline } from './offline'
import { encodeHarte, scoreBeats } from './score'
import { barPhase, liveTimeline, mergeLive } from './timeline'

const SR = 22050

/** A chord as stacked harmonic tones (bass note an octave down), plus a kick on every beat. */
function render(progression: string[][], bpm: number, beatsPerChord = 4, sr = SR): { audio: Float32Array; beats: number[] } {
  const beatS = 60 / bpm
  const total = progression.length * beatsPerChord * beatS
  const n = Math.round(total * sr)
  const audio = new Float32Array(n)
  const midi: Record<string, number> = { C: 60, 'C♯': 61, D: 62, 'E♭': 63, E: 64, F: 65, 'F♯': 66, G: 67, 'A♭': 68, A: 69, 'B♭': 70, B: 71 }
  const beats: number[] = []
  progression.forEach((notes, ci) => {
    const t0 = ci * beatsPerChord * beatS
    const a = Math.round(t0 * sr)
    const b = Math.round((t0 + beatsPerChord * beatS) * sr)
    const pitches = [midi[notes[0]!]! - 24, ...notes.map((x) => midi[x]!)]
    for (const m of pitches) {
      const f = 440 * 2 ** ((m - 69) / 12)
      for (let h = 1; h <= 6; h++) {
        if (f * h > sr / 2) break
        const amp = (0.08 * 0.6 ** (h - 1)) / Math.sqrt(pitches.length)
        const w = (2 * Math.PI * f * h) / sr
        for (let i = a; i < b; i++) audio[i]! += amp * Math.sin(w * i)
      }
    }
  })
  for (let t = 0; t < total - 1e-9; t += beatS) {
    beats.push(t * 1000)
    const a = Math.round(t * sr)
    for (let i = 0; i < 0.06 * sr && a + i < n; i++) audio[a + i]! += 0.5 * Math.exp(-i / (0.012 * sr)) * Math.sin((2 * Math.PI * 60 * i) / sr)
  }
  return { audio, beats }
}

const LOOP = [
  ['C', 'E', 'G'],
  ['A', 'C', 'E'],
  ['F', 'A', 'C'],
  ['G', 'B', 'D'],
]

describe('fft and frontend', () => {
  test('a sine peaks in its bin', () => {
    const n = 1024
    const fft = new FFT(n)
    const w = hann(n)
    const frame = Float32Array.from({ length: n }, (_, i) => w[i]! * Math.sin((2 * Math.PI * 64 * i) / n))
    const mag = fft.magnitudes(frame, new Float32Array(n / 2 + 1))
    expect(mag.indexOf(Math.max(...mag))).toBe(64)
  })

  test('a C major triad lights C, E and G in the treble and C in the bass', () => {
    const { audio } = render([['C', 'E', 'G']], 120, 8)
    const fe = new Frontend({ sampleRate: SR, tuning: 0 })
    const frames: { bass: Float32Array; treble: Float32Array }[] = []
    fe.push(audio, (f) => frames.push(f))
    const mid = frames[frames.length >> 1]!
    const top3 = [...mid.treble].map((v, p) => [v, p] as const).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, p]) => p)
    expect(top3.sort()).toEqual([0, 4, 7])
    expect(mid.bass.indexOf(Math.max(...mid.bass))).toBe(0)
  })
})

describe('beats', () => {
  test('tracks a steady kick at 100 BPM', () => {
    const { audio, beats } = render([...LOOP, ...LOOP, ...LOOP], 100)
    const fe = new Frontend({ sampleRate: SR })
    const bt = new BeatTracker({ fps: fe.sr / 128 })
    fe.push(audio, () => {}, (o) => void bt.push(o.t, o.value))
    bt.flush()
    expect(bt.bpm).toBeGreaterThan(97)
    expect(bt.bpm).toBeLessThan(103)
    expect(beatF(beats, bt.beats.map((t) => t * 1000))).toBeGreaterThan(0.9)
  })
})

describe('chords', () => {
  test('states and symbols round-trip', () => {
    expect(STATES).toHaveLength(61)
    for (let s = 0; s < STATES.length; s++) expect(stateOfSymbol(stateText(s))).toBe(s)
    expect(stateText(stateOfSymbol('C9'))).toBe('C7')
    expect(stateText(stateOfSymbol('F♯m7♭5'))).toBe('F♯m')
    expect(stateOfSymbol('N.C.')).toBe(0)
  })

  test('decodes I–vi–IV–V offline on the tracked beats', () => {
    const { audio, beats } = render([...LOOP, ...LOOP, ...LOOP], 110)
    const out = decodeOffline(audio, SR)
    const truth = [...LOOP, ...LOOP, ...LOOP].map((c, i) => ({
      startMs: i * 4 * (60000 / 110),
      endMs: (i + 1) * 4 * (60000 / 110),
      harte: `${c[0]}:${c[1] === 'C' || c[1] === 'B♭' ? 'min' : 'maj'}`.replace('A:maj', 'A:min'),
    }))
    const s = scoreBeats(truth, beats, out.chords)
    expect(s.majmin).toBeGreaterThan(0.85)
  })
})

describe('live decoder', () => {
  test('shows the chord heard now, predicts the repeat, and finishes', () => {
    const { audio } = render([...LOOP, ...LOOP, ...LOOP, ...LOOP], 100)
    const dec = new LiveDecoder({ sampleRate: SR })
    let hits = 0
    let n = 0
    let predicted = 0
    const chordMs = 4 * 600
    for (let i = 0; i < audio.length; i += 1024) {
      dec.push(audio.subarray(i, i + 1024))
      const now = dec.now()
      const t = (i + 1024) / SR
      // skip the first 8 s (tempo lock) and the first beat of each chord (latency)
      const inChord = (t * 1000) % chordMs
      if (t < 8 || inChord < 600) continue
      const want = ['C', 'Am', 'F', 'G'][Math.floor((t * 1000) / chordMs) % 4]
      n++
      if (now.symbol === want) hits++
      if (now.predicted.length) predicted++
    }
    expect(hits / n).toBeGreaterThan(0.8)
    expect(predicted).toBeGreaterThan(0)
    const fin = dec.finish()
    expect(fin.chords.map((c) => c.symbol)).toEqual(expect.arrayContaining(['C', 'Am', 'F', 'G']))
  })
})

describe('score', () => {
  test('Harte labels encode like mir_eval', () => {
    expect(encodeHarte('C')).toEqual({ root: 0, bits: 0b10010001 })
    expect(encodeHarte('A:min7')).toEqual({ root: 9, bits: 0b10010001001 })
    expect(encodeHarte('G/5').root).toBe(7)
    expect(encodeHarte('Eb:7(#9)')).toEqual(encodeHarte('Eb:7'))
    expect(encodeHarte('N').root).toBe(-1)
    expect(encodeHarte('X').root).toBe(-2)
  })

  test('majmin ignores sevenths, sevenths does not', () => {
    const truth = [{ startMs: 0, endMs: 2000, harte: 'G:7' }]
    const s = scoreBeats(truth, [0, 500, 1000, 1500, 2000], [{ startMs: 0, endMs: 2000, symbol: 'G' }])
    expect(s.majmin).toBe(1)
    expect(s.sevenths).toBe(0)
  })
})

describe('live timelines', () => {
  const beats = Array.from({ length: 33 }, (_, i) => 1000 + i * 500)
  const chords = [
    { startMs: 2000, endMs: 4000, symbol: 'C', confidence: 0.9 },
    { startMs: 4000, endMs: 6000, symbol: 'Am', confidence: 0.8 },
    { startMs: 6000, endMs: 8000, symbol: 'F', confidence: 0.7 },
    { startMs: 8000, endMs: 10000, symbol: 'G', confidence: 0.6 },
  ]

  test('builds a valid Timeline with bar lines where the chords change', () => {
    const tl = liveTimeline({ id: 'spotify:track:7iN1s7xHE4ifF5povM6A48', durationMs: 20000, chords, beats, createdAt: '2026-10-11T12:00:00.000Z' })
    expect(Timeline.safeParse(tl).success).toBe(true)
    expect(tl.source).toBe('live')
    expect(barPhase(chords, beats)).toBe(2)
    expect(tl.bars[0]!.startMs).toBe(2000)
    expect(tl.tempo[0]!.bpm).toBe(120)
    expect(tl.keys[0]).toMatchObject({ tonic: 'C', mode: 'major' })
  })

  test('a newer listen replaces only the span it covers', () => {
    const id = 'spotify:track:7iN1s7xHE4ifF5povM6A48'
    const a = liveTimeline({ id, durationMs: 20000, chords, beats, createdAt: '2026-10-11T12:00:00.000Z' })
    const b = liveTimeline({
      id,
      durationMs: 20000,
      chords: [{ startMs: 6000, endMs: 8000, symbol: 'Dm', confidence: 0.9 }],
      beats: beats.filter((t) => t >= 6000 && t <= 8000),
      createdAt: '2026-10-11T12:05:00.000Z',
    })
    const m = mergeLive(a, b)
    expect(m.chords.map((c) => c.symbol)).toEqual(['C', 'Am', 'Dm', 'G'])
    expect(Timeline.safeParse(m).success).toBe(true)
  })
})
