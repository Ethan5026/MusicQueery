// Solo view (M9): the analysed lead melody in written pitch for the instrument (D-05), spelled in the key at each
// note, the whole line moved by octaves into the instrument's comfortable range so its shape is kept; only notes
// that still fall outside what the staff should show are folded one by one (octave slips, mostly).
import type { Timeline } from '@mq/model'
import {
  type InstrumentId,
  type Key,
  type Note,
  NATURAL_PC,
  analyseTimeline,
  mod,
  noteName,
  pc,
  simplify,
  spell,
  toWritten,
} from '@mq/theory'

/** Written minus concert, in semitones: alto reads a major 6th up, tenor a major 9th up (D-05). */
export const WRITTEN_SEMIS: Record<InstrumentId, number> = { concert: 0, alto: 9, tenor: 14 }

/** MIDI ranges, written: `lo`–`hi` comfortable (the line is centred there), `flo`–`fhi` the outer limits. */
export const RANGE: Record<InstrumentId, { lo: number; hi: number; flo: number; fhi: number }> = {
  concert: { lo: 60, hi: 81, flo: 55, fhi: 88 },
  alto: { lo: 62, hi: 84, flo: 58, fhi: 89 },
  tenor: { lo: 62, hi: 84, flo: 58, fhi: 89 },
}

/** Letter steps above the tonic for each semitone: 1 ♭2 2 ♭3 3 4 ♯4 5 ♭6 6 ♭7 7 (minor keys read the same). */
const LETTER_OFF = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6] as const

export interface SoloNote {
  index: number
  startMs: number
  endMs: number
  /** fractional beat index (the timeline's beat grid) */
  startBeat: number
  endBeat: number
  /** written MIDI pitch after the octave shift and folding */
  midi: number
  name: string
  /** diatonic staff position: 28 = middle C, 30 = bottom line E (as Staff.tsx) */
  p: number
  acc: number
  /** low confidence: drawn lighter */
  faint: boolean
}

export interface SoloLine {
  notes: SoloNote[]
  /** semitones added to every written note */
  shift: number
  /** notes moved on their own to stay inside the outer range */
  folded: number
}

/** The octave shift (a multiple of 12) that keeps most notes in lo..hi, then the median nearest the middle. */
export function octaveShift(midi: number[], lo: number, hi: number): number {
  if (!midi.length) return 0
  const sorted = [...midi].sort((a, b) => a - b)
  const median = sorted[sorted.length >> 1]!
  let best = 0
  let bestCost = Infinity
  for (let k = -4; k <= 4; k++) {
    const out = midi.reduce((n, m) => n + (m + 12 * k < lo || m + 12 * k > hi ? 1 : 0), 0)
    const cost = out * 100 + Math.abs(median + 12 * k - (lo + hi) / 2)
    if (cost < bestCost) {
      bestCost = cost
      best = 12 * k
    }
  }
  return best
}

/** A written pitch spelled in a key whose tonic is already written pitch. */
export function spellIn(midi: number, tonic: Note): Note {
  const n = spell(tonic.letter + LETTER_OFF[mod(midi - pc(tonic), 12)]!, midi)
  return Math.abs(n.acc) >= 2 ? simplify(n) : n
}

/** Staff position of a spelled note at a MIDI pitch (B♯3 sits on B3's line, C♭5 on C5's space). */
export function staffPos(n: Note, midi: number): number {
  const octave = Math.round((midi - NATURAL_PC[n.letter]! - n.acc) / 12) - 1
  return 28 + (octave - 4) * 7 + n.letter
}

const C_MAJOR: Key = { tonic: { letter: 0, acc: 0 }, mode: 'major' }

const cache = new WeakMap<Timeline, Map<InstrumentId, SoloLine>>()

export function soloLine(tl: Timeline, inst: InstrumentId): SoloLine {
  let byInst = cache.get(tl)
  if (!byInst) cache.set(tl, (byInst = new Map()))
  const hit = byInst.get(inst)
  if (hit) return hit
  const mel = tl.melody ?? []
  const a = analyseTimeline(tl)
  const ev = a.events
  const r = RANGE[inst]
  const written = mel.map((n) => n.midi + WRITTEN_SEMIS[inst])
  const shift = octaveShift(written, r.lo, r.hi)
  let folded = 0
  let e = 0
  const notes = mel.map((n, index): SoloNote => {
    let midi = written[index]! + shift
    if (midi < r.flo || midi > r.fhi) folded++
    while (midi < r.flo) midi += 12
    while (midi > r.fhi) midi -= 12
    while (e + 1 < ev.length && ev[e + 1]!.startMs <= n.startMs) e++
    const key = ev[e]?.key ?? C_MAJOR
    const spelled = spellIn(midi, toWritten(key.tonic, inst))
    return {
      index,
      startMs: n.startMs,
      endMs: n.endMs,
      startBeat: a.beatAt(n.startMs),
      endBeat: a.beatAt(n.endMs),
      midi,
      name: noteName(spelled),
      p: staffPos(spelled, midi),
      acc: spelled.acc,
      faint: (n.confidence ?? 1) < 0.5,
    }
  })
  const line = { notes, shift, folded }
  byInst.set(inst, line)
  return line
}

/** First note ending after `beat` (binary search; notes are in time order). */
export function firstNoteAfter(notes: SoloNote[], beat: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (notes[mid]!.endBeat <= beat) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The notes overlapping [from, to) beats, and rests for the gaps of a beat or more between them. */
export function soloWindow(notes: SoloNote[], from: number, to: number): { notes: SoloNote[]; rests: number[] } {
  const out: SoloNote[] = []
  for (let i = firstNoteAfter(notes, from); i < notes.length && notes[i]!.startBeat < to; i++) out.push(notes[i]!)
  const rests: number[] = []
  let prevEnd = from
  for (const n of [...out, null]) {
    const start = n ? n.startBeat : to
    for (let b = Math.ceil(prevEnd - 1e-6); b + 1 <= start + 1e-6; b++) rests.push(b + 0.5)
    if (n) prevEnd = Math.max(prevEnd, n.endBeat)
  }
  return { notes: out, rests }
}

/** Pitch classes the melody plays in [from, to) beats, written. */
export function melodyPcs(notes: SoloNote[], from: number, to: number): Set<number> {
  const s = new Set<number>()
  for (let i = firstNoteAfter(notes, from); i < notes.length && notes[i]!.startBeat < to; i++) s.add(mod(notes[i]!.midi, 12))
  return s
}
