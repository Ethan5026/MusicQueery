// The band's sample kit (public/samples, CREDITS.md there): piano every minor third, double bass, a small drum kit.
// Each buffer is decoded once; its onset is found (mp3 and AAC start with encoder padding that would put every note
// late) and its peak measured, so playback starts on the attack and every sample plays at a known level.
import type { DrumPiece } from '@mq/band'
import { log } from '../debug/log'

export interface Sample {
  buffer: AudioBuffer
  /** seconds of padding before the attack */
  offset: number
  /** 1 / peak, so a sample's loudest point plays at full scale before mixing */
  norm: number
  /** MIDI note of a pitched sample */
  midi: number
}

export interface Kit {
  piano: Sample[]
  bass: Sample[]
  drums: Record<DrumPiece, Sample>
  bytes: number
  ms: number
}

const PIANO = ['A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7']
const BASS = ['c1', 'eb1', 'g1', 'bb1', 'd2', 'f2', 'a2', 'c3', 'e3', 'g3', 'a3']
const DRUMS: DrumPiece[] = ['ride', 'bell', 'crash', 'hhfoot', 'hhclosed', 'hhopen', 'kick', 'snare', 'ghost', 'xstick', 'shaker']

/** Every file the kit loads (also precached by the service worker). */
export const KIT_FILES = [
  ...PIANO.map((n) => `piano/${n}.mp3`),
  ...BASS.map((n) => `bass/${n}.mp3`),
  ...DRUMS.map((n) => `drums/${n}.mp3`),
]

const LETTER: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

/** `Ds4`, `bb1`, `C7` → MIDI (C4 = 60). */
export function sampleMidi(name: string): number {
  const m = name.toLowerCase().match(/^([a-g])(s|#|b)?(-?\d)$/)
  if (!m) throw new Error(`bad sample name ${name}`)
  const acc = m[2] === 's' || m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return 12 * (Number(m[3]) + 1) + LETTER[m[1]!]! + acc
}

/** Seconds before the first sample above 5% of the peak, less 2 ms so the attack's start is kept. */
export function onsetOf(data: Float32Array, sampleRate: number): { offset: number; peak: number } {
  let peak = 0
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]!)
    if (a > peak) peak = a
  }
  const thr = peak * 0.05
  let i = 0
  while (i < data.length && Math.abs(data[i]!) < thr) i++
  return { offset: Math.max(0, i / sampleRate - 0.002), peak: peak || 1 }
}

async function loadOne(ctx: BaseAudioContext, file: string): Promise<{ s: Sample; bytes: number }> {
  const res = await fetch(`/samples/${file}`)
  if (!res.ok) throw new Error(`${file}: ${res.status}`)
  const data = await res.arrayBuffer()
  const bytes = data.byteLength
  const buffer = await ctx.decodeAudioData(data)
  const { offset, peak } = onsetOf(buffer.getChannelData(0), buffer.sampleRate)
  const name = file.slice(file.indexOf('/') + 1, -4)
  const midi = file.startsWith('drums/') ? 0 : sampleMidi(name)
  return { s: { buffer, offset, norm: 1 / peak, midi }, bytes }
}

let loading: Promise<Kit> | null = null

/** Loads the kit once (later calls share the same promise). `onProgress` gets 0..1. */
export function loadKit(ctx: BaseAudioContext, onProgress?: (f: number) => void): Promise<Kit> {
  loading ??= (async () => {
    const t0 = performance.now()
    let done = 0
    let bytes = 0
    const one = async (f: string) => {
      const r = await loadOne(ctx, f)
      bytes += r.bytes
      onProgress?.(++done / KIT_FILES.length)
      return r.s
    }
    const [piano, bass, drums] = await Promise.all([
      Promise.all(PIANO.map((n) => one(`piano/${n}.mp3`))),
      Promise.all(BASS.map((n) => one(`bass/${n}.mp3`))),
      Promise.all(DRUMS.map((n) => one(`drums/${n}.mp3`))),
    ])
    const kit: Kit = {
      piano,
      bass,
      drums: Object.fromEntries(DRUMS.map((d, i) => [d, drums[i]!])) as Record<DrumPiece, Sample>,
      bytes,
      ms: performance.now() - t0,
    }
    log('info', 'audio.kit_loaded', { files: KIT_FILES.length, kb: Math.round(bytes / 1024), ms: Math.round(kit.ms) })
    return kit
  })().catch((err: unknown) => {
    loading = null
    log('warn', 'audio.kit_failed', { err: String(err) })
    throw err
  })
  return loading
}

/** The pitched sample nearest `midi` (samples sorted by note). */
export function nearestSample(samples: Sample[], midi: number): Sample {
  let best = samples[0]!
  for (const s of samples) if (Math.abs(s.midi - midi) < Math.abs(best.midi - midi)) best = s
  return best
}
