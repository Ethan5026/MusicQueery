// The whole decoder run over a finished recording: used by the evaluation and by tests. The live path
// (`LiveDecoder`) runs the same stages incrementally.
import { BeatTracker, beatF } from './beats'
import { type ChromaFrame, Frontend, type OnsetFrame } from './frontend'
import {
  type BeatFeature,
  DEFAULT_EMISSION,
  DEFAULT_TRANSITION,
  type EmissionParams,
  type TransitionParams,
  changePrior,
  emissions,
  stateText,
  viterbi,
} from './chords'
import { keyWeights } from './keys'
import type { Span } from './score'

export interface OfflineOptions {
  /** use `truthBeats` instead of the beat tracker */
  oracleBeats?: boolean
  truthBeats?: number[]
  emission?: Partial<EmissionParams>
  transition?: Partial<TransitionParams>
  nnls?: boolean
  /** fixed tuning (semitones) instead of the running estimate */
  tuning?: number
  /** key-aware change prior (default on) */
  keyPrior?: boolean
}

export interface OfflineResult {
  chords: Span[]
  beats: number[]
  tuning: number
  beatF?: number
}

export function frontendFrames(
  audio: Float32Array,
  sr: number,
  nnls = true,
  tuning?: number,
): { frames: ChromaFrame[]; onsets: OnsetFrame[]; tuning: number } {
  const fe = new Frontend({ sampleRate: sr, nnls, ...(tuning !== undefined ? { tuning } : {}) })
  const frames: ChromaFrame[] = []
  const onsets: OnsetFrame[] = []
  const step = 4096
  for (let i = 0; i < audio.length; i += step)
    fe.push(
      audio.subarray(i, i + step),
      (f) => frames.push(f),
      (o) => onsets.push(o),
    )
  return { frames, onsets, tuning: fe.tuning }
}

/** Mean chroma per beat interval [beats[i], beats[i+1]) (ms). */
export function beatSync(frames: ChromaFrame[], beatsMs: number[]): BeatFeature[] {
  const out: BeatFeature[] = []
  let j = 0
  for (let i = 0; i + 1 < beatsMs.length; i++) {
    const a = beatsMs[i]! / 1000
    const b = beatsMs[i + 1]! / 1000
    const bass = new Float32Array(12)
    const treble = new Float32Array(12)
    let db = -120
    let n = 0
    while (j < frames.length && frames[j]!.t < a) j++
    for (let k = j; k < frames.length && frames[k]!.t < b; k++) {
      const f = frames[k]!
      for (let p = 0; p < 12; p++) {
        bass[p]! += f.bass[p]!
        treble[p]! += f.treble[p]!
      }
      db = Math.max(db, f.db)
      n++
    }
    if (n === 0) {
      // a beat shorter than a hop: take the nearest frame
      const f = frames[Math.min(j, frames.length - 1)]
      if (f) {
        bass.set(f.bass)
        treble.set(f.treble)
        db = f.db
      }
    }
    out.push({ bass, treble, db })
  }
  return out
}

export function decodeOffline(audio: Float32Array, sr: number, opts: OfflineOptions = {}): OfflineResult {
  const { frames, onsets, tuning } = frontendFrames(audio, sr, opts.nnls ?? true, opts.tuning)
  let beats: number[]
  let bf: number | undefined
  if (opts.oracleBeats && opts.truthBeats) beats = opts.truthBeats
  else {
    beats = trackBeats(onsets)
    if (opts.truthBeats) bf = beatF(opts.truthBeats, beats)
  }
  const feats = beatSync(frames, beats)
  const ep = { ...DEFAULT_EMISSION, ...opts.emission }
  const tp = { ...DEFAULT_TRANSITION, ...opts.transition }
  const ll = feats.map((f) => emissions(f, ep))
  let priors: Float32Array[] | null = null
  if (opts.keyPrior ?? true) {
    const total = new Float32Array(12)
    for (const f of feats) for (let p = 0; p < 12; p++) total[p]! += f.treble[p]!
    const prior = changePrior(keyWeights(total), tp)
    priors = feats.map(() => prior)
  }
  const path = viterbi(ll, priors, tp)
  return { chords: spans(path, beats), beats, tuning, ...(bf !== undefined ? { beatF: bf } : {}) }
}

/** Beat-level states → chord spans (runs merged). */
export function spans(path: number[], beatsMs: number[]): Span[] {
  const out: Span[] = []
  for (let i = 0; i < path.length; i++) {
    const symbol = stateText(path[i]!)
    const last = out[out.length - 1]
    if (last && last.symbol === symbol) last.endMs = beatsMs[i + 1]!
    else out.push({ startMs: beatsMs[i]!, endMs: beatsMs[i + 1]!, symbol })
  }
  return out
}

/** Beats (ms) from the online tracker run over the whole onset envelope. */
export function trackBeats(onsets: OnsetFrame[]): number[] {
  if (onsets.length < 2) return []
  const fps = 1 / (onsets[1]!.t - onsets[0]!.t)
  const bt = new BeatTracker({ fps })
  for (const o of onsets) bt.push(o.t, o.value)
  bt.flush()
  return bt.beats.map((t) => t * 1000)
}
