// Lead sheet view (M10): the song engraved as staves. Each bar carries the chords at their beats, the time
// signature where the bar's beat count says it changes, the key signature where the key changes, and on the
// treble staff the scale for the chords, written once per run of chords that share the same notes, starting on
// the first chord's root and spread across the beats it covers. Piano adds a bass staff with each chord stacked
// in root position (a slash chord's bass below it), in note values as long as the chord lasts, tied over bar
// lines. Nothing is invented: the notes are the Play mode's (play.ts), the rhythm is the timeline's.
// Every sharp and flat is written on its note even when the key signature has it (the signature is there to
// learn from); a natural is written where the signature or an earlier note in the bar would otherwise alter it.
// Pure, so it is built once per timeline, instrument and Play mode; `layout` breaks it into systems for a width.
import type { Timeline } from '@mq/model'
import {
  type Chord,
  type InstrumentId,
  type Key,
  type Lens,
  type MomentChord,
  type Note,
  analyseTimeline,
  chordNotes,
  chordTones,
  chordToWritten,
  momentChord,
  mod,
  note,
  noteName,
  pc,
  scaleFor,
  toWritten,
} from '@mq/theory'
import { type PlayMode, type Role, alterScale, keyScale } from './play'

export interface Meter {
  num: number
  den: number
}

export interface Sig {
  /** sharps (+) or flats (−) in the key signature */
  fifths: number
  /** written key, e.g. "E♭ major" */
  name: string
}

export interface ScoreNote {
  name: string
  /** diatonic staff position: 28 = middle C, 30 = treble bottom line E, 18 = bass bottom line G */
  p: number
  acc: number
  /** written accidental glyph ('' for none): every sharp/flat, and naturals where needed */
  glyph: string
  role: Role
}

export interface ChordMark {
  /** beat within the bar */
  beat: number
  chord: MomentChord
  event: number
  /** started in an earlier bar (shown in brackets at the start of a system) */
  held: boolean
}

/** A chord stacked on the treble staff, at its beat. */
export interface Block {
  beat: number
  notes: ScoreNote[]
}

/** One run of chords sharing a scale on the treble staff: [from, to) beats in the bar. A fresh run (the scale
 *  changed) writes the whole scale across its beats; otherwise each chord that starts in it is stacked, and the
 *  scale is written again only where a new line begins with it (`layout` decides). */
export interface Run {
  from: number
  to: number
  title: string
  fresh: boolean
  notes: ScoreNote[]
  blocks: Block[]
}

/** A chord on the bass staff (piano): its stack and how long it sounds in this bar. */
export interface BassPiece {
  from: number
  beats: number
  stack: ScoreNote[]
  /** tied from the bar before, and into the bar after */
  tieIn: boolean
  tieOut: boolean
}

export interface Span {
  from: number
  beats: number
}

export interface Measure {
  /** index into timeline.bars */
  bar: number
  n: number
  startMs: number
  endMs: number
  /** integer beat index of the bar line */
  startBeat: number
  beats: number
  meter: Meter
  /** time signature drawn here: the first bar or a change */
  showMeter: boolean
  sig: Sig
  /** the key changes here (not the first bar): labelled in rust */
  keyChange: boolean
  /** and its signature with it: the new signature engraved after a double bar */
  sigChange: boolean
  /** signature before the change, for cancelling naturals */
  prevSig: Sig | null
  reh: string | null
  /** double bar after: the end of a pass, or the song */
  end: boolean
  chords: ChordMark[]
  runs: Run[]
  bass: BassPiece[]
  /** no chord (N.C., before the first chord) */
  rests: Span[]
  /** the same chords and notes as the bar before: may be drawn as a bar-repeat sign */
  same: boolean
}

export interface Score {
  measures: Measure[]
  piano: boolean
  /** measure index of each timeline bar */
  measureOf: number[]
}

const LETTER_FIFTHS = [0, 2, 4, -1, 1, 3, 5] // C D E F G A B
/** Letters in the order sharps and flats are added. */
export const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]
export const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]
/** Staff positions of the signature's accidentals on the treble staff; the bass staff is 14 lower. */
export const SHARP_POS = [38, 35, 39, 36, 33, 37, 34]
export const FLAT_POS = [34, 37, 33, 36, 32, 35, 31]

/** Sharps (+) or flats (−) for a key; a theoretical key (more than 7) takes its enharmonic signature. */
export function fifthsOf(tonic: Note, mode: Key['mode']): number {
  let f = LETTER_FIFTHS[tonic.letter]! + 7 * tonic.acc - (mode === 'minor' ? 3 : 0)
  if (f > 7) f -= 12
  if (f < -7) f += 12
  return f
}

/** The signature's alteration for each letter C..B. */
export function sigAccs(fifths: number): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0]
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER
  for (let i = 0; i < Math.abs(fifths); i++) out[order[i]!] = Math.sign(fifths)
  return out
}

const GLYPH: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 1: '♯', 2: '𝄪' }

const r2 = (x: number): number => Math.round(x * 2) / 2

/** The scale on a chord under the Play mode, written, and which notes Integrated swapped in. */
function chordScale(
  c: Chord,
  key: Key,
  next: Chord | null,
  mode: PlayMode,
  lens: Lens,
  inst: InstrumentId,
): { notes: string[]; changed: Set<string>; title: string } {
  if (mode === 'advanced') {
    const s = scaleFor(c, key, next, lens, inst)
    return { notes: s.notes, changed: new Set(), title: `${s.root} ${s.name}` }
  }
  const wk = { tonic: noteName(toWritten(key.tonic, inst)), mode: key.mode }
  const scale = keyScale(wk)
  const title = `${wk.tonic} ${wk.mode}`
  if (mode === 'simple') return { notes: scale, changed: new Set(), title }
  const tones = chordNotes(chordToWritten(c, inst)).map((t) => noteName(t.note))
  const outside = tones.filter((n) => !scale.some((s) => pc(note(s)) === pc(note(n))))
  if (!outside.length) return { notes: scale, changed: new Set(), title }
  const alt = alterScale(scale, outside)
  return { notes: alt.notes, changed: new Set(alt.changed), title: `${title}, ${alt.changed.join(' ')}` }
}

/** The scale turned to start on the chord's root (the same note, else the same pitch, else the same letter). */
export function rotateTo(notes: string[], root: string): string[] {
  const r = note(root)
  let i = notes.indexOf(root)
  if (i < 0) i = notes.findIndex((n) => pc(note(n)) === pc(r))
  if (i < 0) i = notes.findIndex((n) => note(n).letter === r.letter)
  if (i <= 0) return notes
  return [...notes.slice(i), ...notes.slice(0, i)]
}

/** Treble positions for an ascending scale: the first note between D4 and C5. */
function trebleLine(notes: string[]): Array<{ name: string; p: number; acc: number }> {
  let prev = -1
  let prevLetter = 0
  return notes.map((name, i) => {
    const n = note(name)
    let p: number
    if (i === 0) {
      p = 28 + n.letter
      if (p < 29) p += 7
    } else p = prev + mod(n.letter - prevLetter, 7)
    prev = p
    prevLetter = n.letter
    return { name, p, acc: n.acc }
  })
}

/** A chord stacked on the treble staff in root position (tensions above the 7th), the root between D4 and C5,
 *  or an octave lower when the stack would climb past C6. */
export function trebleBlock(c: Chord): Array<{ name: string; p: number; acc: number }> {
  const out: Array<{ name: string; p: number; acc: number }> = []
  let prev = -1
  for (const t of chordNotes(c)) {
    const n = t.note
    let p = prev < 0 ? 28 + n.letter : prev + mod(n.letter - (prev % 7), 7)
    if (prev < 0 && p < 29) p += 7
    if (p <= prev) p += 7
    out.push({ name: noteName(n), p, acc: n.acc })
    prev = p
  }
  if (out[out.length - 1]!.p > 42 && out[0]!.p - 7 >= 26) for (const o of out) o.p -= 7
  return out
}

/** Bass-staff stack: root position upwards (each note above the last), a slash bass under the root; the octave
 *  that needs the fewest ledger lines, the root nearest C3 on a tie. */
export function bassStack(c: Chord): Array<{ name: string; p: number; acc: number }> {
  const ns = chordNotes(c).map((t) => t.note)
  const best = { cost: Infinity, out: [] as Array<{ name: string; p: number; acc: number }> }
  for (const base of [14, 21]) {
    const out: Array<{ name: string; p: number; acc: number }> = []
    let prev = -1
    for (const n of ns) {
      let p = prev < 0 ? base + n.letter : prev + mod(n.letter - (prev % 7), 7)
      if (p <= prev) p += 7
      out.push({ name: noteName(n), p, acc: n.acc })
      prev = p
    }
    if (c.bass && pc(c.bass) !== pc(c.root)) {
      let p = out[0]!.p - mod(out[0]!.p - c.bass.letter, 7)
      if (p >= out[0]!.p) p -= 7
      out.unshift({ name: noteName(c.bass), p, acc: c.bass.acc })
    }
    const lo = out[0]!.p
    const hi = out[out.length - 1]!.p
    const cost = Math.max(0, Math.ceil((18 - lo) / 2)) + Math.max(0, Math.ceil((hi - 26) / 2)) + Math.abs(base + ns[0]!.letter - 21) / 100
    if (cost < best.cost) {
      best.cost = cost
      best.out = out
    }
  }
  return best.out
}

/** Accidental glyphs for one staff through one bar: every sharp/flat, a natural where it would otherwise be read altered. */
function markAccidentals(notes: Array<{ p: number; acc: number; name: string }>, keyAcc: number[], seen: Map<number, number>): string[] {
  return notes.map((n) => {
    const letter = mod(n.p, 7)
    const before = seen.get(n.p) ?? keyAcc[letter]!
    seen.set(n.p, n.acc)
    if (n.acc !== 0) return GLYPH[n.acc] ?? ''
    return before !== 0 ? '♮' : ''
  })
}

/** Beats in each bar, from the beat grid. */
function barBeats(tl: Timeline, i: number, beatAt: (ms: number) => number): { start: number; beats: number } {
  const bars = tl.bars
  const start = Math.round(beatAt(bars[i]!.startMs))
  const next = bars[i + 1]
  if (next) return { start, beats: Math.max(1, Math.round(beatAt(next.startMs)) - start) }
  const left = Math.round(beatAt(tl.durationMs)) - start
  return { start, beats: Math.max(1, Math.min(tl.meter.num, left)) }
}

export function engrave(tl: Timeline, inst: InstrumentId, mode: PlayMode, lens: Lens): Score {
  const a = analyseTimeline(tl)
  const ev = a.events
  const piano = inst === 'concert'
  const bars = tl.bars
  const measures: Measure[] = []
  const measureOf: number[] = []
  let e0 = 0
  let prevSig: Sig | null = null
  let prevMeter: Meter | null = null
  let prevKey: Key | null = null
  let lastSet: string | null = null

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    const { start, beats } = barBeats(tl, i, a.beatAt)
    const end = start + beats
    // the time signature: the bar's own beat count, except a short first bar (a pickup) or a short last bar
    let meter: Meter = { num: beats, den: tl.meter.den }
    const pickup = i === 0 && beats < tl.meter.num
    const tail = i === bars.length - 1 && prevMeter !== null && beats < prevMeter.num
    if (pickup) meter = { ...tl.meter }
    else if (tail) meter = prevMeter!
    const showMeter = prevMeter === null || prevMeter.num !== meter.num || prevMeter.den !== meter.den

    // chord pieces in the bar
    while (e0 < ev.length && r2(ev[e0]!.endBeat) <= start) e0++
    type Piece = { from: number; to: number; e: number; held: boolean }
    const pieces: Piece[] = []
    for (let k = e0; k < ev.length && r2(ev[k]!.startBeat) < end; k++) {
      const x = ev[k]!
      const from = Math.max(r2(x.startBeat), start) - start
      const to = Math.min(r2(x.endBeat), end) - start
      if (to - from < 0.5) continue
      pieces.push({ from, to, e: k, held: r2(x.startBeat) < start })
    }

    // the key: the chord sounding at the bar line (a change inside a bar is signed from the next bar)
    const atLine = pieces.find((p) => p.from === 0 && ev[p.e]!.chord.kind === 'chord') ?? pieces.find((p) => ev[p.e]!.chord.kind === 'chord')
    const key: Key = atLine ? ev[atLine.e]!.key : (prevKey ?? { tonic: { letter: 0, acc: 0 }, mode: 'major' })
    prevKey = key
    const wt = toWritten(key.tonic, inst)
    const sig: Sig = { fifths: fifthsOf(wt, key.mode), name: `${noteName(wt)} ${key.mode}` }
    const keyChange = prevSig !== null && prevSig.name !== sig.name
    const sigChange = prevSig !== null && prevSig.fifths !== sig.fifths
    const keyAcc = sigAccs(sig.fifths)

    const chords: ChordMark[] = []
    const rests: Span[] = []
    const runs: Run[] = []
    const bass: BassPiece[] = []
    let cursor = 0
    const trebleSeen = new Map<number, number>()
    const bassSeen = new Map<number, number>()
    type Member = { from: number; to: number; c: Chord; changed: Set<string>; held: boolean }
    type Group = { from: number; to: number; set: string; title: string; notes: string[]; members: Member[] }
    let group: Group | null = null
    const flush = () => {
      if (!group) return
      const g = group
      const fresh = g.set !== lastSet
      lastSet = g.set
      // glyphs follow what is drawn in the bar; the variant not drawn (a restated scale) is marked on its own
      const line = trebleLine(g.notes)
      const glyphs = markAccidentals(line, keyAcc, fresh ? trebleSeen : new Map())
      const n = line.length
      const blocks: Block[] = []
      const blockSeen = fresh ? new Map<number, number>() : trebleSeen
      for (const mm of g.members) {
        if (mm.held) continue
        const stack = trebleBlock(chordToWritten(mm.c, inst))
        const bg = markAccidentals(stack, keyAcc, blockSeen)
        blocks.push({ beat: mm.from, notes: stack.map((x, j) => ({ ...x, glyph: bg[j]!, role: roleIn(x.name, mm.c, mm.changed, inst) })) })
      }
      runs.push({
        from: g.from,
        to: g.to,
        title: g.title,
        fresh,
        notes: line.map((x, j) => {
          const at = g.from + ((j + 0.5) / n) * (g.to - g.from)
          const mem = g.members.find((mm) => at < mm.to) ?? g.members[g.members.length - 1]!
          return { ...x, glyph: glyphs[j]!, role: roleIn(x.name, mem.c, mem.changed, inst) }
        }),
        blocks,
      })
      group = null
    }
    for (const p of pieces) {
      const x = ev[p.e]!
      if (p.from > cursor) {
        flush()
        rests.push({ from: cursor, beats: p.from - cursor })
      }
      cursor = p.to
      if (x.chord.kind !== 'chord') {
        flush()
        lastSet = null
        rests.push({ from: p.from, beats: p.to - p.from })
        continue
      }
      const c = x.chord
      chords.push({ beat: p.from, chord: momentChord(c, inst), event: p.e, held: p.held })
      const nextC = ev[p.e + 1]?.chord
      const sc = chordScale(c, x.key, nextC?.kind === 'chord' ? nextC : null, mode, lens, inst)
      const set = sc.notes.map((s) => pc(note(s))).sort((u, v) => u - v).join(',')
      const wc = chordToWritten(c, inst)
      if (group && group.set === set && group.to === p.from) {
        group.to = p.to
        group.members.push({ from: p.from, to: p.to, c, changed: sc.changed, held: p.held })
      } else {
        flush()
        group = { from: p.from, to: p.to, set, title: sc.title, notes: rotateTo(sc.notes, noteName(wc.root)), members: [{ from: p.from, to: p.to, c, changed: sc.changed, held: p.held }] }
      }
      if (piano) {
        const stack = bassStack(c)
        const glyphs = markAccidentals(stack, keyAcc, bassSeen)
        bass.push({
          from: p.from,
          beats: p.to - p.from,
          stack: stack.map((s, j) => ({ ...s, glyph: glyphs[j]!, role: '' })),
          tieIn: p.held && p.from === 0,
          tieOut: r2(x.endBeat) > end,
        })
      }
    }
    flush()
    if (cursor < beats) rests.push({ from: cursor, beats: beats - cursor })

    const next = bars[i + 1]
    const newSection = !!b.section && (i === 0 || bars[i - 1]!.section !== b.section || bars[i - 1]!.pass !== b.pass)
    const nextStart = next ? next.startMs : tl.durationMs
    const m: Measure = {
      bar: i,
      n: b.number,
      startMs: b.startMs,
      endMs: nextStart,
      startBeat: start,
      beats,
      meter,
      showMeter,
      sig,
      keyChange,
      sigChange,
      prevSig: sigChange ? prevSig : null,
      reh: newSection ? (b.section ?? null) : null,
      end: !next || (next.pass !== undefined && b.pass !== undefined && next.pass !== b.pass),
      chords,
      runs,
      bass,
      rests,
      same: false,
    }
    const prev = measures[measures.length - 1]
    m.same = !!prev && !m.showMeter && !m.keyChange && !m.reh && chords.length > 0 && content(prev) === content(m)
    measures.push(m)
    measureOf[i] = measures.length - 1
    prevSig = sig
    prevMeter = meter
  }
  return { measures, piano, measureOf }
}

function roleIn(name: string, c: Chord, changed: Set<string>, inst: InstrumentId): Role {
  if (changed.has(name)) return 'x'
  const wc = chordToWritten(c, inst)
  const p = pc(note(name))
  const tone = chordTones(wc).find((t) => pc(t.note) === p)
  if (tone) return tone.slot === '3' || tone.slot === '7' ? 'g' : 't'
  return chordNotes(wc).some((t) => pc(t.note) === p) ? 't' : ''
}

/** What a bar shows, for spotting a bar that repeats the one before. */
function content(m: Measure): string {
  return JSON.stringify([
    m.beats,
    m.chords.map((c) => [c.beat, c.chord.symbol]),
    m.runs.map((r) => [r.from, r.to, r.fresh, r.notes.map((n) => n.name + n.role), r.blocks.map((b) => [b.beat, b.notes.map((n) => n.name)])]),
    m.rests.map((r) => [r.from, r.beats]),
  ])
}

// ---------------------------------------------------------------- note values

export interface Val {
  /** beats from the piece start */
  at: number
  /** length as a fraction of a whole note: 1, ½, ¼, ⅛, ¹⁄₁₆ */
  base: number
  dots: number
}

const BASES = [1, 0.5, 0.25, 0.125, 0.0625]

/** A length in beats written as tied note values, longest first (a dotted value where it fits exactly). */
export function noteValues(beats: number, den: number, dotted = true): Val[] {
  let left = beats / den
  const out: Val[] = []
  let at = 0
  while (left > 1e-6 && out.length < 8) {
    let pick: Val | null = null
    for (const b of BASES) {
      if (dotted && b * 1.5 <= left + 1e-6 && b < 1) {
        pick = { at, base: b, dots: 1 }
        break
      }
      if (b <= left + 1e-6) {
        pick = { at, base: b, dots: 0 }
        break
      }
    }
    if (!pick) break
    out.push(pick)
    const len = pick.base * (pick.dots ? 1.5 : 1)
    left -= len
    at += len * den
  }
  return out
}

/** Beat index → ms on the timeline's grid (extrapolated past its ends). */
export function msAtBeat(tl: Timeline, beat: number): number {
  const b = tl.beats
  if (b.length < 2) return (b[0] ?? 0) + beat * (60000 / (tl.tempo[0]?.bpm ?? 120))
  const i = Math.max(0, Math.min(b.length - 2, Math.floor(beat)))
  return b[i]! + (beat - i) * (b[i + 1]! - b[i]!)
}

// ---------------------------------------------------------------- layout (in staff spaces)

export const U = {
  clef: 3.6,
  sigAcc: 1.05,
  sigPad: 0.9,
  time: 2.6,
  padL: 1.4,
  padR: 0.7,
  note: 2.2,
  acc: 0.95,
  beat: 1.6,
  rest: 2.4,
  bassVal: 2.6,
  bassAcc: 1.8,
  repeat: 4.5,
}

export interface Slot {
  from: number
  to: number
  x0: number
  x1: number
}

export interface Placed {
  m: Measure
  /** bar line before the measure, the first beat's x, and the bar line after */
  x0: number
  xin: number
  x1: number
  /** cancel naturals and the new key signature, a new time signature: drawn after the bar line */
  showSig: boolean
  showMeter: boolean
  repeat: boolean
  /** first on its line: the first run's scale is written out again, a held chord shown in brackets */
  restate: boolean
  slots: Slot[]
}

export interface System {
  index: number
  placed: Placed[]
  width: number
  /** the head: clef, key signature (and the time signature on the first bar of the song) */
  headW: number
  /** how far the notes were squeezed to fit (1 = not at all) */
  fit: number
}

/** The tightest a line's notes may be spaced, as a share of their natural room. */
export const SQUEEZE = 0.92

const sigW = (fifths: number): number => (fifths ? Math.abs(fifths) * U.sigAcc + U.sigPad : 0.4)

/** Width of a chord symbol, roughly, in staff spaces. */
const chordW = (c: MomentChord): number => {
  const letters = (t: string): number => [...t].reduce((w, ch) => w + (/[♯♭𝄪𝄫]/u.test(ch) ? 1.0 : 1.6), 0)
  return letters(c.root) + [...c.quality].length * 1.15 + (c.bass ? 1 + letters(c.bass) : 0) + 1.4
}

/** Whether a run writes its whole scale: a fresh scale, or the first run of a line (restated). */
export const isFull = (m: Measure, r: Run, restate: boolean): boolean => r.fresh || (restate && r === m.runs[0])

const blockW = (b: Block): number => 3 + Math.min(2, b.notes.filter((n) => n.glyph).length) * U.acc

/** Slot boundaries: where a run or rest starts or ends, and inside a run of stacked chords each chord; with the
 *  room each slot needs for its notes, rests, bass chords and chord symbols. */
function slotsOf(m: Measure, piano: boolean, restate: boolean): Array<{ from: number; to: number; need: number }> {
  const cuts = new Set<number>([0, m.beats])
  for (const r of m.runs) cuts.add(r.from).add(r.to)
  for (const c of m.chords) cuts.add(c.beat)
  for (const r of m.rests) cuts.add(r.from).add(r.from + r.beats)
  const xs = [...cuts].sort((u, v) => u - v)
  const out: Array<{ from: number; to: number; need: number }> = []
  for (let i = 0; i + 1 < xs.length; i++) {
    const from = xs[i]!
    const to = xs[i + 1]!
    let need = (to - from) * U.beat
    const run = m.runs.find((r) => r.from <= from && r.to > from)
    if (run && isFull(m, run, restate)) {
      // a written-out scale spreads over its chords' slots by their beats
      const all = run.notes.reduce((w, n) => w + U.note + (n.glyph ? U.acc : 0), 0)
      need = Math.max(need, (all * (to - from)) / (run.to - run.from))
    } else if (run) {
      const b = run.blocks.find((x) => x.beat === from)
      if (b) need = Math.max(need, blockW(b))
    }
    const rest = m.rests.find((r) => r.from === from)
    if (rest) need = Math.max(need, noteValues(rest.beats, m.meter.den, false).length * U.rest)
    if (piano)
      need = Math.max(
        need,
        m.bass.filter((p) => p.from >= from && p.from < to).reduce((w, p) => w + noteValues(p.beats, m.meter.den).length * U.bassVal + (p.stack.some((s) => s.glyph) ? U.bassAcc : 0), 0),
      )
    // a chord symbol needs its own room before the next one
    const sym = m.chords.find((c) => c.beat === from && !(c.held && !restate))
    if (sym) need = Math.max(need, chordW(sym.chord))
    out.push({ from, to, need })
  }
  return out
}

function measureW(m: Measure, piano: boolean, first: boolean): { w: number; head: number; repeat: boolean } {
  const head = (!first && m.sigChange ? sigW(m.sig.fifths) + cancelCount(m) * U.sigAcc : 0) + (m.showMeter && !(first && m.bar === 0) ? U.time : 0)
  if (m.same && !first) return { w: Math.max(U.repeat, m.beats * U.beat * 0.8) + head, head, repeat: true }
  const body = slotsOf(m, piano, first).reduce((w, s) => w + s.need, 0)
  return { w: head + U.padL + body + U.padR, head, repeat: false }
}

/** Naturals to cancel signature accidentals that the new signature drops. */
export function cancelCount(m: Measure): number {
  if (!m.prevSig) return 0
  const before = sigAccs(m.prevSig.fifths)
  const after = sigAccs(m.sig.fifths)
  return before.filter((v, i) => v !== 0 && after[i] !== v && after[i] === 0).length
}

/** Breaks the score into systems `width` staff spaces wide, justified (the last only as far as it is full). */
export function layout(score: Score, width: number): { systems: System[]; systemOf: number[] } {
  const systems: System[] = []
  const systemOf: number[] = []
  const ms = score.measures
  let i = 0
  type Entry = { m: Measure; head: number; repeat: boolean; first: boolean; slots: Array<{ from: number; to: number; need: number }>; fixed: number; body: number }
  const entry = (m: Measure, first: boolean): Entry => {
    const mw = measureW(m, score.piano, first)
    if (mw.repeat) return { m, head: mw.head, repeat: true, first, slots: [], fixed: mw.w, body: 0 }
    const slots = slotsOf(m, score.piano, first)
    return { m, head: mw.head, repeat: false, first, slots, fixed: mw.head + U.padL + U.padR, body: slots.reduce((w, x) => w + x.need, 0) }
  }
  while (i < ms.length) {
    const first = ms[i]!
    const headW = U.clef + sigW(first.sig.fifths) + (first.bar === 0 ? U.time : 0)
    const row: Entry[] = []
    let fixed = headW
    let body = 0
    // a line takes another bar while it fits with its notes squeezed to SQUEEZE of their room
    while (i < ms.length) {
      const e = entry(ms[i]!, row.length === 0)
      if (row.length && fixed + e.fixed + (body + e.body) * SQUEEZE > width) break
      row.push(e)
      fixed += e.fixed
      body += e.body
      i++
    }
    const fit = body > 0 ? Math.min(1, Math.max(0, width - fixed) / body) : 1
    const extra = Math.max(0, width - fixed - body * fit)
    const last = i >= ms.length
    // stretch by beats so the time feel stays even; a short last line is not pulled across the page
    const beatsInRow = row.reduce((n, r) => n + r.m.beats, 0)
    const perBeat = last && extra > beatsInRow * U.beat * 1.5 ? 0 : extra / beatsInRow
    let x = headW
    const placed: Placed[] = []
    for (const r of row) {
      const grow = perBeat * r.m.beats
      const x0 = x
      const xin = x0 + r.head + (r.repeat ? 0 : U.padL)
      const slots: Slot[] = []
      let x1: number
      if (!r.repeat) {
        let sx = xin
        for (const s of r.slots) {
          const w = s.need * fit + grow * ((s.to - s.from) / r.m.beats)
          slots.push({ from: s.from, to: s.to, x0: sx, x1: sx + w })
          sx += w
        }
        x1 = sx + U.padR
      } else {
        x1 = x0 + r.fixed + grow
        slots.push({ from: 0, to: r.m.beats, x0: xin, x1: x1 - U.padR })
      }
      placed.push({ m: r.m, x0, xin, x1, showSig: !r.first && r.m.sigChange, showMeter: r.m.showMeter && !(r.first && r.m.bar === 0), repeat: r.repeat, restate: r.first, slots })
      systemOf[r.m.bar] = systems.length
      x = x1
    }
    systems.push({ index: systems.length, placed, width: x, headW, fit })
  }
  return { systems, systemOf }
}

/** x of a beat within a placed measure, through its slots. */
export function beatX(p: Placed, beat: number): number {
  for (const s of p.slots) if (beat < s.to || s === p.slots[p.slots.length - 1]) return s.x0 + ((Math.min(beat, s.to) - s.from) / (s.to - s.from || 1)) * (s.x1 - s.x0)
  return p.xin
}

/** The beat under an x within a placed measure. */
export function xBeat(p: Placed, x: number): number {
  for (const s of p.slots) if (x < s.x1 || s === p.slots[p.slots.length - 1]) return s.from + Math.max(0, Math.min(1, (x - s.x0) / (s.x1 - s.x0 || 1))) * (s.to - s.from)
  return 0
}

// ---------------------------------------------------------------- page turns

export interface PageRow {
  sys: System
  /** which line of the window it stands on */
  slot: number
  /** shown only right of this x (staff spaces): bars already played, covered by the next line */
  from?: number
  /** shown only left of this x: the next line's opening bars, in the room the played bars left */
  to?: number
}

/** What the window shows, turning pages rather than scrolling. With two or more lines each system keeps its own slot
 *  (system i on line i mod n): once a line is played the next unseen one takes its place, so nothing moves under the
 *  eye. With one line, the bars already played are covered by as many whole bars of the next line as fit there. */
export function pageRows(systems: System[], cur: number, curBar: number, visible: number): PageRow[] {
  const rows: PageRow[] = []
  const now = systems[cur]
  if (!now) return rows
  if (visible >= 2) {
    for (let i = cur; i < Math.min(systems.length, cur + visible); i++) rows.push({ sys: systems[i]!, slot: i % visible })
    return rows
  }
  const next = systems[cur + 1]
  const at = now.placed.find((p) => p.m.bar === curBar)
  let room = 0
  if (next && at) for (const p of next.placed) if (p.x1 <= at.x0 + 1e-6) room = p.x1
  if (room > 0) {
    rows.push({ sys: next!, slot: 0, to: room })
    rows.push({ sys: now, slot: 0, from: room })
  } else rows.push({ sys: now, slot: 0 })
  return rows
}

