// Web Worker hosting the live chord decoder (M7). Mic chunks come straight from the AudioWorklet over a
// MessagePort; the main thread sends anchors (mic frame ↔ track position) so everything leaves here in track ms.
// A segment is one stretch of continuous playback: a seek, pause or track change ends it, and its chords are
// re-decoded with two-way chorus consensus ('final') before the next segment starts fresh.
import { LiveDecoder, type LiveChord, stateOfSymbol } from '@mq/listen'

export interface Anchor {
  frame: number
  trackMs: number
  playing: boolean
  trackId: string | null
}

export interface TrackChord {
  startMs: number
  endMs: number
  symbol: string
  confidence: number
}

export type ToWorker =
  | { type: 'start'; sampleRate: number; port: MessagePort }
  | { type: 'anchor'; anchor: Anchor }
  | { type: 'segment'; reason: string }
  | { type: 'prior'; trackId: string; chords: TrackChord[] }
  | { type: 'stop' }

export interface NowMsg {
  type: 'now'
  trackId: string | null
  symbol: string | null
  confidence: number
  sinceMs: number
  bpm: number
  db: number
  predicted: TrackChord[]
  settled: TrackChord[]
  beats: number[]
  /** decoder CPU per second of audio (ms) */
  cpu: number
}

export interface FinalMsg {
  type: 'final'
  trackId: string
  reason: string
  chords: TrackChord[]
  beats: number[]
  seconds: number
}

export type FromWorker = NowMsg | FinalMsg | { type: 'error'; message: string }

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m)

let sr = 48000
let dec: LiveDecoder | null = null
/** mic frame of the segment's first sample */
let f0 = -1
let segTrack: string | null = null
const anchors: Anchor[] = []
let prior: { trackId: string; chords: TrackChord[] } | null = null
let cpuMs = 0
let cpuAudio = 0
let lastPost = 0
let lastSymbol: string | null = null

/** Track ms of mic frame `frame`, from the last anchor at or before it (playing), else null. */
function trackAt(frame: number): number | null {
  for (let i = anchors.length - 1; i >= 0; i--) {
    const a = anchors[i]!
    if (a.frame <= frame || i === 0) {
      if (!a.playing || a.trackId !== segTrack) return null
      return a.trackMs + ((frame - a.frame) / sr) * 1000
    }
  }
  return null
}

const streamToTrack = (t: number): number | null => trackAt(f0 + t * sr)

function toTrack(cs: LiveChord[]): TrackChord[] {
  const out: TrackChord[] = []
  for (const c of cs) {
    const a = streamToTrack(c.start)
    const b = streamToTrack(c.end)
    if (a === null || b === null || b <= a) continue
    out.push({ startMs: Math.round(a), endMs: Math.round(b), symbol: c.symbol, confidence: c.confidence })
  }
  return out
}

function newDecoder(): LiveDecoder {
  const tid = segTrack
  return new LiveDecoder({
    sampleRate: sr,
    prior: (t) => {
      if (!prior || prior.trackId !== tid) return null
      const ms = streamToTrack(t)
      if (ms === null) return null
      const c = prior.chords.find((x) => x.startMs <= ms && x.endMs > ms)
      return c ? { state: stateOfSymbol(c.symbol), weight: 3 * c.confidence } : null
    },
  })
}

function endSegment(reason: string): void {
  if (dec && segTrack) {
    const fin = dec.finish()
    const seconds = dec.now().t
    const beats = fin.beats.map(streamToTrack).filter((x): x is number => x !== null).map(Math.round)
    post({ type: 'final', trackId: segTrack, reason, chords: toTrack(fin.chords), beats, seconds })
  }
  dec = null
  f0 = -1
}

function onChunk(frame: number, samples: Float32Array): void {
  const last = anchors[anchors.length - 1]
  if (!last || !last.playing || !last.trackId) {
    if (dec) endSegment('not playing')
    return
  }
  if (dec && last.trackId !== segTrack) endSegment('track')
  if (!dec) {
    segTrack = last.trackId
    f0 = frame
    dec = newDecoder()
  }
  const t0 = performance.now()
  dec.push(samples)
  cpuMs += performance.now() - t0
  cpuAudio += samples.length / sr
  const now = dec.now()
  const at = performance.now()
  if (now.symbol !== lastSymbol || at - lastPost > 125) {
    lastSymbol = now.symbol
    lastPost = at
    const since = streamToTrack(now.since)
    const nowMs = streamToTrack(now.t) ?? 0
    post({
      type: 'now',
      trackId: segTrack,
      symbol: now.symbol,
      confidence: now.confidence,
      sinceMs: since ?? nowMs,
      bpm: now.bpm,
      db: now.db,
      predicted: toTrack(now.predicted),
      settled: toTrack(dec.settledChords()),
      beats: dec.beatTimes.map(streamToTrack).filter((x): x is number => x !== null).map(Math.round),
      cpu: cpuAudio > 0 ? (cpuMs / cpuAudio) : 0,
    })
    if (cpuAudio > 30) {
      cpuMs /= 2
      cpuAudio /= 2
    }
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  try {
    switch (m.type) {
      case 'start':
        sr = m.sampleRate
        m.port.onmessage = (ev: MessageEvent<{ frame: number; samples: Float32Array }>) => onChunk(ev.data.frame, ev.data.samples)
        break
      case 'anchor':
        anchors.push(m.anchor)
        if (anchors.length > 400) anchors.splice(0, 200)
        break
      case 'segment':
        endSegment(m.reason)
        break
      case 'prior':
        prior = { trackId: m.trackId, chords: m.chords }
        break
      case 'stop':
        endSegment('stop')
        break
    }
  } catch (err) {
    post({ type: 'error', message: String(err) })
  }
}
