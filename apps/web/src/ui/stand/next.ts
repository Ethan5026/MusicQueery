// The landscape Next staff: the next point where what to play changes. Not simply the next chord: Dm7 → G7 → Cmaj7
// share one set of notes, so Next skips to the first chord whose notes differ from Now (in the current Play mode)
// and marks the notes that change. Computed once per chord change; the beat countdown is derived per beat.
import type { Timeline } from '@mq/model'
import { type Moment, type MomentChord, type Prefs, analyseTimeline, moment, note, pc } from '@mq/theory'
import { type PlayMode, type PlayView, playView } from './play'

export interface NextChange {
  /** the view at the change: unchanged notes plain, changed ones rust */
  view: PlayView
  eventIndex: number
  /** fractional beat where it starts (count down with m.beat) */
  startBeat: number
  chord: MomentChord | null
  /** spelled notes that are new */
  changed: string[]
}

export interface NextResult {
  next: NextChange | null
  /** last event looked at, for "same notes through bar N" */
  lastEventIndex: number
}

/** Chord changes looked ahead (about four bars of two-chord bars). */
export const LOOKAHEAD = 16

const pcOf = (n: string): number => pc(note(n))

export function nextChange(tl: Timeline, m: Moment, mode: PlayMode, prefs: Prefs, lookahead = LOOKAHEAD): NextResult {
  const ev = analyseTimeline(tl).events
  const start = m.next[0]?.eventIndex ?? ev.length
  const now = playView(m, mode, { preview: false })
  const nowPcs = new Set((now?.notes ?? []).map((n) => pcOf(n.name)))
  let last = m.eventIndex
  for (let k = start; k < ev.length && k < start + lookahead; k++) {
    last = k
    const mk = moment(tl, ev[k]!.startMs + 1, prefs)
    const v = playView(mk, mode, { preview: false })
    if (!v) continue
    const changed = v.notes.filter((n) => !nowPcs.has(pcOf(n.name))).map((n) => n.name)
    const dropped = [...nowPcs].some((p) => !v.notes.some((n) => pcOf(n.name) === p))
    if (!now || changed.length || dropped)
      return {
        next: {
          view: { ...v, notes: v.notes.map((n) => ({ ...n, role: changed.includes(n.name) ? 'x' : '' })) },
          eventIndex: k,
          startBeat: ev[k]!.startBeat,
          chord: mk.chord,
          changed,
        },
        lastEventIndex: k,
      }
  }
  return { next: null, lastEventIndex: last }
}

/** Beats until a change at `startBeat`, the way moment() counts (the change's own beat included). */
export const beatsUntil = (startBeat: number, beat: number): number => Math.max(0, Math.ceil(startBeat - beat - 1e-9))
