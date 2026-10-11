// The landscape lead sheet (sketch "Lead sheet"): the timeline's bars, four to a line, each with the chords
// that sound in it (width by duration), rehearsal letters, double bars at the end of a pass, and key marks
// where the key changes. Pure, so it can be built once per timeline and instrument.
import type { Timeline } from '@mq/model'
import { type InstrumentId, type MomentChord, analyseTimeline, momentChord, noteName, toWritten } from '@mq/theory'

export interface SheetChord {
  chord: MomentChord
  /** share of the bar (flex-grow) */
  share: number
  /** carried over from the previous bar */
  held: boolean
}

export interface SheetBar {
  /** index into timeline.bars */
  index: number
  n: number
  startMs: number
  endMs: number
  chords: SheetChord[]
  /** blank share before the first chord (no chord yet) */
  lead: number
  reh: string | null
  kmark: { text: string; home: boolean } | null
  end: boolean
}

export interface Sheet {
  rows: SheetBar[][]
  /** row of each timeline bar */
  rowOf: number[]
}

export const BARS_PER_ROW = 4
/** Chords are beat-synced; anything this close to a bar line belongs to the bar it starts. */
const TOL_MS = 80

const keyLabel = (tonic: string, mode: 'major' | 'minor'): string => `${tonic} ${mode}`

export function buildSheet(tl: Timeline, inst: InstrumentId): Sheet {
  const ev = analyseTimeline(tl).events
  const bars = tl.bars
  const out: SheetBar[] = []
  let e0 = 0
  let prevKey: string | null = null
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    const prev = bars[i - 1]
    const next = bars[i + 1]
    const s = b.startMs
    const end = next ? next.startMs : Math.min(tl.durationMs, s + (prev ? s - prev.startMs : tl.durationMs - s))
    const len = Math.max(1, end - s)
    // Chord changes and bar lines come from different models; a chord starting just before the line is this bar's.
    const halfBeat = len / tl.meter.num / 2
    while (e0 < ev.length && ev[e0]!.endMs <= s + Math.min(TOL_MS, halfBeat)) e0++
    const chords: SheetChord[] = []
    let lead = 0
    let kmark: SheetBar['kmark'] = null
    for (let k = e0; k < ev.length && ev[k]!.startMs < end - TOL_MS; k++) {
      const x = ev[k]!
      if (chords.length === 0 && x.startMs > s + TOL_MS) lead = (x.startMs - s) / len
      const held = prev !== undefined && x.startMs < s - halfBeat
      chords.push({
        chord: momentChord(x.chord, inst),
        share: (Math.min(x.endMs, end) - Math.max(x.startMs, s)) / len,
        held,
      })
      const key = keyLabel(noteName(toWritten(x.key.tonic, inst)), x.key.mode)
      if (prevKey === null) kmark = { text: key, home: true }
      else if (key !== prevKey && !held && !kmark) kmark = { text: `→ ${key}`, home: false }
      prevKey = key
    }
    const newSection = !!b.section && (!prev || prev.section !== b.section || prev.pass !== b.pass)
    out.push({
      index: i,
      n: b.number,
      startMs: s,
      endMs: end,
      chords,
      lead,
      reh: newSection ? (b.section ?? null) : null,
      kmark,
      end: !next || (next.pass !== undefined && b.pass !== undefined && next.pass !== b.pass),
    })
  }

  const rows: SheetBar[][] = []
  const rowOf: number[] = []
  let row: SheetBar[] = []
  for (const bar of out) {
    const pass = bars[bar.index]!.pass
    const prevPass = bars[bar.index - 1]?.pass
    if (row.length === BARS_PER_ROW || (row.length > 0 && (bar.reh || pass !== prevPass))) {
      rows.push(row)
      row = []
    }
    row.push(bar)
    rowOf[bar.index] = rows.length
  }
  if (row.length) rows.push(row)
  return { rows, rowOf }
}

/** First visible row so that the current row sits second from the top (the sketch's scroll rule). */
export function topRow(row: number, rows: number, visible: number): number {
  return Math.max(0, Math.min(rows - visible, row - 1))
}
