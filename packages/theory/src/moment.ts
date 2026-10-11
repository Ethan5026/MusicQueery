// theory.moment(timeline, position, prefs) (D-16): everything a screen shows at one instant, derived
// purely from a Timeline v1. The per-timeline analysis (keys, functions, ii–Vs) is computed once and cached.
import type { Timeline, TimelineBar, TimelineSource } from '@mq/model'
import {
  type Chord,
  type ChordSymbol,
  NC,
  type Slot,
  chordTones,
  formatChord,
  formatQuality,
  parseChord,
} from './chord'
import { type TwoFive, findTwoFives, guideTones } from './guide'
import { type InstrumentId, INSTRUMENTS, chordToWritten, toWritten } from './instrument'
import { type HarmonicFunction, type Key, harmonicFunction, majorDegree, sameKey } from './numeral'
import { noteName, note, pc } from './pitch'
import { detectKeys } from './regions'
import { type Lens, type ScaleId, LENSES, SCALES, pickScale, scaleNotes } from './scales'

export interface AnalysedEvent {
  index: number
  symbol: string
  chord: ChordSymbol
  startMs: number
  endMs: number
  /** fractional beat index of the start / end */
  startBeat: number
  endBeat: number
  key: Key
  fn: HarmonicFunction
}

export interface Analysis {
  events: AnalysedEvent[]
  twoFives: TwoFive[]
  beatAt: (ms: number) => number
}

const cache = new WeakMap<Timeline, Analysis>()

/** Chord spans with the timeline's user edits applied (later edits win). */
export function effectiveChords(tl: Timeline): Timeline['chords'] {
  let spans = tl.chords.map((c) => ({ ...c }))
  for (const e of tl.edits) {
    const next: Timeline['chords'] = []
    for (const c of spans) {
      if (c.endMs <= e.startMs || c.startMs >= e.endMs) {
        next.push(c)
        continue
      }
      if (c.startMs < e.startMs) next.push({ ...c, endMs: e.startMs })
      if (c.endMs > e.endMs) next.push({ ...c, startMs: e.endMs })
    }
    next.push({ startMs: e.startMs, endMs: e.endMs, symbol: e.symbol, confidence: 1 })
    spans = next.sort((a, b) => a.startMs - b.startMs)
  }
  return spans
}

function makeBeatAt(tl: Timeline): (ms: number) => number {
  const b = tl.beats
  const bpm = tl.tempo[0]?.bpm ?? 120
  const beatMs = 60000 / bpm
  if (b.length < 2) return (ms) => (ms - (b[0] ?? 0)) / beatMs
  return (ms) => {
    if (ms <= b[0]!) return (ms - b[0]!) / (b[1]! - b[0]!)
    const last = b.length - 1
    if (ms >= b[last]!) return last + (ms - b[last]!) / (b[last]! - b[last - 1]!)
    let lo = 0
    let hi = last
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (b[mid]! <= ms) lo = mid
      else hi = mid
    }
    return lo + (ms - b[lo]!) / (b[lo + 1]! - b[lo]!)
  }
}

const snap = (x: number): number => (Math.abs(x - Math.round(x)) < 0.02 ? Math.round(x) : x)

export function analyseTimeline(tl: Timeline): Analysis {
  const hit = cache.get(tl)
  if (hit) return hit
  const beatAt = makeBeatAt(tl)
  const spans = effectiveChords(tl)
  const chords = spans.map((c) => parseChord(c.symbol) ?? NC)
  let keys: Key[]
  if (tl.keys.length) {
    keys = spans.map((c) => {
      const mid = (c.startMs + c.endMs) / 2
      const k = tl.keys.find((k) => mid >= k.startMs && mid < k.endMs) ?? tl.keys[tl.keys.length - 1]!
      return { tonic: note(k.tonic), mode: k.mode }
    })
  } else {
    keys = detectKeys(chords.map((chord, i) => ({ chord, beats: beatAt(spans[i]!.endMs) - beatAt(spans[i]!.startMs) }))).keys
  }
  const events: AnalysedEvent[] = spans.map((c, i) => ({
    index: i,
    symbol: c.symbol,
    chord: chords[i]!,
    startMs: c.startMs,
    endMs: c.endMs,
    startBeat: snap(beatAt(c.startMs)),
    endBeat: snap(beatAt(c.endMs)),
    key: keys[i]!,
    fn: harmonicFunction(chords[i - 1] ?? null, chords[i]!, chords[i + 1] ?? null, keys[i]!, chords[i + 2] ?? null),
  }))
  const a: Analysis = { events, twoFives: findTwoFives(chords), beatAt }
  cache.set(tl, a)
  return a
}

// ---------------------------------------------------------------- moment

export interface Prefs {
  instrument: InstrumentId
  lens: Lens
}

export interface MomentChord {
  /** written symbol for the instrument */
  symbol: string
  root: string
  quality: string
  bass?: string
  /** concert-pitch symbol */
  concert: string
}

export interface MomentKey {
  tonic: string
  mode: Key['mode']
}

export interface MomentScale {
  id: ScaleId
  name: string
  root: string
  notes: string[]
}

export interface Moment {
  source: TimelineSource
  instrument: InstrumentId
  instrumentLabel: string
  positionMs: number
  /** fractional beat index into timeline.beats */
  beat: number
  /** 0-based beat within the bar, and how far through the bar (0..1) */
  beatInBar: number
  barFraction: number
  bar: TimelineBar | null
  barIndex: number
  /** index into analysis.events; −1 before the first chord or past the last */
  eventIndex: number
  chord: MomentChord | null
  fn: Pick<HarmonicFunction, 'kind' | 'text'> | null
  key: MomentKey | null
  next: Array<{ chord: MomentChord; inBeats: number; eventIndex: number }>
  keyChange: { from: MomentKey; to: MomentKey; inBeats: number; eventIndex: number; chord: MomentChord } | null
  /** scale for prefs.lens, and all three lenses */
  scale: MomentScale | null
  scales: Record<Lens, MomentScale> | null
  tones: Array<{ name: string; slot: Slot; degree: string }>
  guide: Array<{ from: string; fromSlot: '3' | '7'; to: string; toSlot: '3' | '7'; semis: number }> | null
  /** first ii–V(–I) starting within the next 8 chords */
  twoFive: (Omit<TwoFive, 'target' | 'line'> & { target: string; line: string[] }) | null
}

export function momentChord(c: ChordSymbol, inst: InstrumentId): MomentChord {
  const concert = formatChord(c)
  if (c.kind === 'nc') return { symbol: concert, root: '', quality: concert, concert }
  const w = chordToWritten(c, inst)
  return {
    symbol: formatChord(w),
    root: noteName(w.root),
    quality: formatQuality(w),
    ...(w.bass ? { bass: noteName(w.bass) } : {}),
    concert,
  }
}

const writtenKey = (k: Key, inst: InstrumentId): MomentKey => ({ tonic: noteName(toWritten(k.tonic, inst)), mode: k.mode })

/** The scale for one chord under a lens, in written pitch. */
export function scaleFor(c: Chord, k: Key, next: ChordSymbol | null, lens: Lens, inst: InstrumentId): MomentScale {
  const id = pickScale(c, { degree: majorDegree(pc(c.root), k), next: next?.kind === 'chord' ? next : null }, lens)
  const root = toWritten(c.root, inst)
  return { id, name: SCALES[id].name, root: noteName(root), notes: scaleNotes(root, id).map((n) => noteName(n)) }
}

export function moment(tl: Timeline, positionMs: number, prefs: Prefs): Moment {
  const a = analyseTimeline(tl)
  const inst = prefs.instrument
  const ev = a.events
  const b = a.beatAt(positionMs)
  let barIndex = -1
  for (let lo = 0, hi = tl.bars.length - 1; lo <= hi; ) {
    const mid = (lo + hi) >> 1
    if (tl.bars[mid]!.startMs <= positionMs) {
      barIndex = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  const bar = tl.bars[barIndex] ?? null
  const barStartBeat = bar ? snap(a.beatAt(bar.startMs)) : 0
  const meterNum = tl.meter.num
  const beatInBar = bar ? Math.max(0, Math.floor(b - barStartBeat + 1e-9)) : 0
  const barFraction = bar ? Math.min(1, Math.max(0, (b - barStartBeat) / meterNum)) : 0

  let i = -1
  for (let lo = 0, hi = ev.length - 1; lo <= hi; ) {
    const mid = (lo + hi) >> 1
    if (ev[mid]!.startMs <= positionMs) {
      i = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  if (i >= 0 && positionMs >= ev[i]!.endMs) i = -1
  const cur = ev[i]
  const firstAhead = cur ? i + 1 : ev.findIndex((e) => e.startMs > positionMs)
  const inBeats = (e: AnalysedEvent): number => Math.ceil(e.startBeat - b - 1e-9)
  const next = firstAhead < 0 ? [] : ev.slice(firstAhead, firstAhead + 4).map((e) => ({
    chord: momentChord(e.chord, inst),
    inBeats: inBeats(e),
    eventIndex: e.index,
  }))

  const base = {
    source: tl.source,
    instrument: inst,
    instrumentLabel: INSTRUMENTS[inst].label,
    positionMs,
    beat: b,
    beatInBar,
    barFraction,
    bar,
    barIndex,
    eventIndex: cur ? i : -1,
    next,
  }
  if (!cur) {
    return { ...base, chord: null, fn: null, key: null, keyChange: null, scale: null, scales: null, tones: [], guide: null, twoFive: null }
  }

  let keyChange: Moment['keyChange'] = null
  for (let j = i + 1; j < ev.length; j++) {
    if (!sameKey(ev[j]!.key, cur.key)) {
      keyChange = {
        from: writtenKey(cur.key, inst),
        to: writtenKey(ev[j]!.key, inst),
        inBeats: inBeats(ev[j]!),
        eventIndex: j,
        chord: momentChord(ev[j]!.chord, inst),
      }
      break
    }
  }

  const nextChord = ev[i + 1]?.chord ?? null
  let scales: Record<Lens, MomentScale> | null = null
  let tones: Moment['tones'] = []
  let guide: Moment['guide'] = null
  if (cur.chord.kind === 'chord') {
    const c = cur.chord
    scales = Object.fromEntries(LENSES.map((l) => [l, scaleFor(c, cur.key, nextChord, l, inst)])) as Record<Lens, MomentScale>
    tones = chordTones(chordToWritten(c, inst)).map((t) => ({ name: noteName(t.note), slot: t.slot, degree: t.degree }))
    if (nextChord?.kind === 'chord') {
      const g = guideTones(chordToWritten(c, inst), chordToWritten(nextChord, inst))
      guide = g ? g.map((m) => ({ from: noteName(m.from), fromSlot: m.fromSlot, to: noteName(m.to), toSlot: m.toSlot, semis: m.semis })) : null
    }
  }

  const tf = a.twoFives.find((t) => t.start + t.length > i && t.start < i + 8)
  const twoFive = tf
    ? { ...tf, target: noteName(toWritten(tf.target, inst)), line: tf.line.map((n) => noteName(toWritten(n, inst))) }
    : null

  return {
    ...base,
    chord: momentChord(cur.chord, inst),
    fn: { kind: cur.fn.kind, text: cur.fn.text },
    key: writtenKey(cur.key, inst),
    keyChange,
    scale: scales ? scales[prefs.lens] : null,
    scales,
    tones,
    guide,
    twoFive,
  }
}
