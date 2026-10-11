// Live chords (track ms) → Timeline v1 with source 'live' (D-04, D-29): keys and spelling from `@mq/theory`'s
// finishAnalysis (the same as the PC's analysis), tempo from the median beat gap, and bar lines every 4 beats
// from the beat phase where chords change most often. `mergeLive` lays a newer listen over an older one.
import type { Timeline } from '@mq/model'
import { finishAnalysis } from '@mq/theory'

export interface TrackSpan {
  startMs: number
  endMs: number
  symbol: string
  confidence?: number
}

export interface LiveTimelineInput {
  id: string
  durationMs: number
  chords: TrackSpan[]
  beats: number[]
  createdAt: string
  generator?: string
  /** a bar-line phase to keep (0..3) instead of guessing; used while a listen grows so bars don't jump */
  phase?: number
}

export const LIVE_GENERATOR = 'mq.listen/1'

export function liveTimeline(o: LiveTimelineInput): Timeline {
  const end = o.durationMs > 0 ? o.durationMs : Infinity
  const chords = o.chords
    .map((c) => ({ ...c, startMs: Math.max(0, c.startMs), endMs: Math.min(end, c.endMs) }))
    .filter((c) => c.endMs > c.startMs)
    .sort((a, b) => a.startMs - b.startMs)
  const beats = dedupe(o.beats.filter((b) => b >= 0 && b <= end).sort((a, b) => a - b))
  const fin = finishAnalysis(chords, beats)
  const phase = o.phase ?? barPhase(fin.chords, beats)
  const bars: Timeline['bars'] = []
  for (let i = phase, n = 1; i < beats.length; i += 4, n++) bars.push({ startMs: round1(beats[i]!), number: n })
  const ibi = median(beats.slice(1).map((b, i) => b - beats[i]!))
  return {
    schema: 'mq.timeline/1',
    id: o.id,
    source: 'live',
    durationMs: Math.round(Number.isFinite(end) ? end : (beats[beats.length - 1] ?? 0)),
    createdAt: o.createdAt,
    generator: o.generator ?? LIVE_GENERATOR,
    meter: { num: 4, den: 4 },
    beats: beats.map(round1),
    bars,
    chords: fin.chords,
    keys: fin.keys,
    tempo: ibi ? [{ startMs: round1(beats[0] ?? 0), bpm: Math.round((60000 / ibi) * 10) / 10 }] : [],
    edits: [],
  }
}

/** The beat phase (mod 4) on which most chord changes land: where the bar lines go. */
export function barPhase(chords: { startMs: number }[], beats: number[]): number {
  if (beats.length < 8) return 0
  const votes = [0, 0, 0, 0]
  let j = 0
  for (const c of chords) {
    while (j + 1 < beats.length && Math.abs(beats[j + 1]! - c.startMs) <= Math.abs(beats[j]! - c.startMs)) j++
    votes[j % 4]!++
  }
  let best = 0
  for (let p = 1; p < 4; p++) if (votes[p]! > votes[best]!) best = p
  return best
}

/**
 * Lays `next` over `prev` (same track): inside the span `next` covers, its chords and beats win; outside it,
 * `prev`'s stay. Edits are kept from both. Keys and bars are rebuilt from the merged chords.
 */
export function mergeLive(prev: Timeline | null, next: Timeline): Timeline {
  if (!prev || prev.id !== next.id || !next.chords.length) return prev && !next.chords.length ? prev : next
  const a = next.chords[0]!.startMs
  const b = next.chords[next.chords.length - 1]!.endMs
  const outside = (s: { startMs: number; endMs: number }) => s.endMs <= a || s.startMs >= b
  const chords: TrackSpan[] = [
    ...prev.chords.filter(outside),
    ...prev.chords
      .filter((c) => !outside(c))
      .flatMap((c) => [
        ...(c.startMs < a ? [{ ...c, endMs: a }] : []),
        ...(c.endMs > b ? [{ ...c, startMs: b }] : []),
      ]),
    ...next.chords,
  ]
  const beats = [...prev.beats.filter((t) => t < a - 100 || t > b + 100), ...next.beats]
  const tl = liveTimeline({
    id: next.id,
    durationMs: Math.max(prev.durationMs, next.durationMs),
    chords,
    beats,
    createdAt: next.createdAt,
    ...(next.generator ? { generator: next.generator } : {}),
  })
  return { ...tl, edits: [...prev.edits, ...next.edits] }
}

function dedupe(sorted: number[]): number[] {
  const out: number[] = []
  for (const t of sorted) if (!out.length || t - out[out.length - 1]! > 60) out.push(t)
  return out
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[s.length >> 1]!
}

const round1 = (x: number): number => Math.round(x * 10) / 10
