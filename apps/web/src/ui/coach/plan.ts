// Scale coach (M8, sketch "Scale coach"): the next eight changes as an improvising plan, each with its scale under
// the chosen lens (Inside / Bebop / Colour), its function in the key, and the note to land on (the 3rd, D-06);
// above them a tip that names the guide-tone line through the next ii–V–I. All in written pitch. Pure.
import type { Timeline } from '@mq/model'
import {
  type InstrumentId,
  type Lens,
  type MomentChord,
  type MomentScale,
  analyseTimeline,
  chordToWritten,
  chordTones,
  momentChord,
  note,
  noteName,
  pc,
  scaleFor,
  toWritten,
} from '@mq/theory'
import { barIndexAt, barPosition } from '../stand/view'

export interface CoachRow {
  eventIndex: number
  startMs: number
  bar: number | null
  chord: MomentChord
  scale: MomentScale
  /** "ii in C major" */
  fn: string
  /** the 3rd (a sus chord's 3rd slot holds its 4th), written */
  land: string
}

export const COACH_CHANGES = 8

/** The changes from event `from` on (chords only; N.C. is skipped). */
export function coachRows(tl: Timeline, from: number, inst: InstrumentId, lens: Lens, n = COACH_CHANGES): CoachRow[] {
  const ev = analyseTimeline(tl).events
  const out: CoachRow[] = []
  for (let i = Math.max(0, from); i < ev.length && out.length < n; i++) {
    const e = ev[i]!
    if (e.chord.kind !== 'chord') continue
    let j = i + 1
    while (j < ev.length && ev[j]!.chord.kind !== 'chord') j++
    const next = ev[j]?.chord ?? null
    const tones = chordTones(chordToWritten(e.chord, inst))
    const land = tones.find((t) => t.slot === '3') ?? tones[0]!
    const key = `${noteName(toWritten(e.key.tonic, inst))} ${e.key.mode}`
    out.push({
      eventIndex: i,
      startMs: e.startMs,
      bar: barPosition(tl, barIndexAt(tl, e.startMs + 1))?.n ?? null,
      chord: momentChord(e.chord, inst),
      scale: scaleFor(e.chord, e.key, next, lens, inst),
      fn: `${e.fn.text} in ${key}`,
      land: noteName(land.note),
    })
  }
  return out
}

export type CoachTip =
  | { kind: 'twoFive'; mode: 'major' | 'minor'; target: string; bar: number | null; line: string[]; resolved: boolean; sub: boolean }
  | { kind: 'none' }

/** The first ii–V(–I) that starts within the next `n` changes, with its guide-tone line, in written pitch. */
export function coachTip(tl: Timeline, from: number, inst: InstrumentId, n = COACH_CHANGES): CoachTip {
  const a = analyseTimeline(tl)
  const start = Math.max(0, from)
  const tf = a.twoFives.find((t) => t.start + t.length > start && t.start < start + n)
  if (!tf) return { kind: 'none' }
  const e = a.events[tf.start]!
  return {
    kind: 'twoFive',
    mode: tf.mode,
    target: noteName(toWritten(tf.target, inst)),
    bar: barPosition(tl, barIndexAt(tl, e.startMs + 1))?.n ?? null,
    line: tf.line.map((x) => noteName(toWritten(x, inst))),
    resolved: tf.length === 3,
    sub: tf.sub,
  }
}

const STEP: Record<number, string> = { 1: 'a half step', 2: 'a whole step', 3: 'a minor 3rd', 4: 'a major 3rd', 5: 'a 4th', 6: 'a tritone' }

/** How a guide-tone line moves, from its notes: "C falls a half step to B, then B holds". */
export function describeLine(line: string[]): string {
  const moves: string[] = []
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!
    const b = line[i + 1]!
    const up = (((pc(note(b)) - pc(note(a))) % 12) + 12) % 12
    const d = up > 6 ? up - 12 : up
    moves.push(d === 0 ? `${a} holds` : `${a} ${d < 0 ? 'falls' : 'rises'} ${STEP[Math.abs(d)]} to ${b}`)
  }
  return moves.join(', then ')
}
