// Bass: a walking line in swing and waltz (root on each chord, chord tones heading for the next root, an approach
// note into it), two-feel in ballads, root–fifth in bossa, roots and octaves in pop, syncopated 16ths in funk.
import { type FormChord, chordAt } from './form'
import { type ChordPcs, chordPcs, nearest } from './notes'
import { pick, weighted } from './rng'
import { type BarCtx, type NoteEvent, swung } from './types'

const LO = 28 // E1
const HI = 55 // G3
const HOME = 40

interface Span {
  chord: FormChord
  pcs: ChordPcs
  start: number
  end: number
  /** the chord after this span (next bar included) */
  next: ChordPcs | null
}

function spans(ctx: BarCtx): Span[] {
  const bar = ctx.form.bars[ctx.barIndex]!
  const out: Span[] = []
  bar.chords.forEach((c, k) => {
    if (!c.chord) return
    const nextChord = bar.chords[k + 1] ?? chordAt(ctx.form, ctx.barIndex + 1, 0).cur
    out.push({
      chord: c,
      pcs: chordPcs(c.chord),
      start: c.beat,
      end: c.beat + c.beats,
      next: nextChord?.chord ? chordPcs(nextChord.chord) : null,
    })
  })
  return out
}

/** A note leading into `target`: a half step either side, a whole step, or its fifth. */
function approach(ctx: BarCtx, target: number, from: number): number {
  const kind = weighted(ctx.rng, [
    ['below', 3],
    ['above', 3],
    ['fifth', 2],
    ['step', 1],
  ] as const)
  const n =
    kind === 'below' ? target - 1 : kind === 'above' ? target + 1 : kind === 'fifth' ? target + (from > target ? 7 : -5) : target + (from > target ? 2 : -2)
  return n < LO ? n + 12 : n > HI ? n - 12 : n
}

function walk(ctx: BarCtx, s: Span, prev: number, out: NoteEvent[], beatOf: (b: number) => number): number {
  const startN = nearest(s.pcs.bass, prev, LO, HI)
  const len = Math.max(1, Math.round(s.end - s.start))
  const target = s.next ? nearest(s.next.bass, startN, LO, HI) : null
  const tones = [s.pcs.root, s.pcs.third ?? s.pcs.fifth, s.pcs.fifth, s.pcs.seventh ?? s.pcs.root]
  let cur = startN
  for (let i = 0; i < len; i++) {
    let n: number
    if (i === 0) n = startN
    else if (i === len - 1 && target !== null) n = approach(ctx, target, cur)
    else {
      // a chord tone a step or a leap away, heading for the target
      const dir = target === null ? (ctx.rng() < 0.5 ? 1 : -1) : Math.sign(target - cur) || 1
      const cands = tones
        .map((p) => nearest(p, cur + dir * 4, LO, HI))
        .filter((m) => m !== cur && Math.abs(m - cur) <= 7)
      n = cands.length ? pick(ctx.rng, cands) : nearest(s.pcs.fifth, cur, LO, HI)
    }
    out.push({ part: 'bass', beat: beatOf(s.start + i), midi: n, vel: i === 0 ? 0.85 : 0.72 + ctx.rng() * 0.08, dur: 0.95 })
    cur = n
  }
  return cur
}

/** One bar of bass. `prev` is the last note of the bar before (null after a seek); returns this bar's last note. */
export function bassBar(ctx: BarCtx, prev: number | null): { events: NoteEvent[]; last: number | null } {
  const bar = ctx.form.bars[ctx.barIndex]!
  const out: NoteEvent[] = []
  const at = (b: number) => bar.startBeat + b
  let last = prev ?? HOME
  const note = (b: number, midi: number, vel: number, dur: number) => {
    out.push({ part: 'bass', beat: at(b), midi, vel, dur })
    last = midi
  }
  for (const s of spans(ctx)) {
    const len = s.end - s.start
    const root = nearest(s.pcs.bass, last, LO, HI)
    const fifth = nearest(s.pcs.fifth, root + 4, LO, HI)
    switch (ctx.style) {
      case 'swing':
      case 'waltz':
        last = walk(ctx, s, last, out, at)
        break
      case 'ballad':
        // half notes: the root, then the fifth or an approach into the next chord
        note(s.start, root, 0.75, Math.min(2, len) - 0.1)
        if (len >= 3) {
          const t = s.next ? approach(ctx, nearest(s.next.bass, root, LO, HI), root) : fifth
          note(s.start + 2, t, 0.68, len - 2.1)
        }
        break
      case 'bossa':
        // root (dotted quarter) and fifth (eighth) per half bar
        for (let b = s.start; b < s.end - 1e-9; b += 2) {
          note(b, root, 0.8, 1.4)
          if (b + 1.5 < s.end) note(b + 1.5, nearest(s.pcs.fifth, root - 5, LO, HI), 0.7, 0.45)
        }
        break
      case 'pop': {
        // roots on the beat, an octave or an approach eighth before a change
        for (let b = s.start; b < s.end - 1e-9; b += 1) {
          const lastBeat = b + 1 >= s.end - 1e-9
          note(b, root, b === s.start ? 0.85 : 0.72, lastBeat && s.next ? 0.45 : 0.9)
          if (lastBeat && s.next) note(b + 0.5, approach(ctx, nearest(s.next.bass, root, LO, HI), root), 0.65, 0.45)
          else if (ctx.rng() < 0.15 && root + 12 <= HI + 5) note(b + 0.5, root + 12, 0.6, 0.4)
        }
        break
      }
      case 'funk': {
        const sev = s.pcs.seventh ?? s.pcs.fifth
        const pat = pick(ctx.rng, [
          [[0, 'r'], [0.75, 'r'], [1.5, 'o'], [2, 'r'], [2.75, '7'], [3.5, '5']],
          [[0, 'r'], [0.5, 'r'], [1.25, '5'], [2, 'r'], [2.5, 'o'], [3.25, '7'], [3.75, '5']],
          [[0, 'r'], [1, 'o'], [1.75, 'r'], [2.5, '5'], [3, '7'], [3.5, 'r']],
        ] as const)
        for (const [b, d] of pat) {
          if (s.start + b >= s.end - 1e-9) continue
          const m = d === 'r' ? root : d === 'o' ? root + 12 : d === '5' ? fifth : nearest(sev, root + 10, LO, HI + 7)
          out.push({ part: 'bass', beat: at(s.start + b), midi: m, vel: b === 0 ? 0.9 : 0.72, dur: 0.3 })
        }
        last = root
        break
      }
      case 'drone':
        break
    }
  }
  // swing feel for the off-beat eighths (pop, bossa and funk are straight)
  for (const e of out) e.beat = bar.startBeat + swung(e.beat - bar.startBeat, ctx.swing)
  return { events: out, last: out.length ? last : prev }
}
