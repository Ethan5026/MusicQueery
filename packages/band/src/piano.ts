// Piano: voicings and comping. Seventh chords get rootless A/B voicings (3-5-7-9 / 7-9-3-5, the 5th becoming the
// 13th on dominants), triads close-position inversions; each chord takes the voicing nearest the last one, so the
// voices move by step. Rhythm by style: Charleston-type comping in swing, sustained rolled chords in ballads,
// the bossa pattern, block chords in pop, 16th stabs in funk, root-and-fifth for drones.
import type { Chord } from '@mq/theory'
import { mod } from '@mq/theory'
import { type FormChord, chordAt } from './form'
import { type ChordPcs, chordPcs } from './notes'
import { pick } from './rng'
import { type BarCtx, type NoteEvent, swung } from './types'

const LOWEST = 48 // C3: below this close voicings turn to mud
const TOP = 79
type Hit = readonly [beat: number, dur: number]

/** Candidate voicings as pitch-class lists, lowest voice first. */
export function voicingShapes(p: ChordPcs, style: BarCtx['style']): number[][] {
  const r = p.root
  if (style === 'drone') return [[r, p.fifth, r]]
  const t = p.third ?? mod(r + 5, 12)
  if (p.seventh === null) {
    const tri = [r, t, p.fifth]
    const shapes = [tri, [t, p.fifth, r], [p.fifth, r, t]]
    const add9 = p.tensions.find((x) => mod(x - r, 12) === 2)
    return shapes.map((s) => (add9 !== undefined ? [...s, add9] : [...s, s[0]!]))
  }
  const s = p.seventh
  const diminished = mod(s - r, 12) === 9 && mod(p.fifth - r, 12) === 6
  if (diminished) return [[r, t, p.fifth, s], [t, p.fifth, s, r]]
  const half = mod(p.fifth - r, 12) === 6
  const nine = p.tensions.find((x) => [1, 2, 3].includes(mod(x - r, 12))) ?? (half ? r : mod(r + 2, 12))
  const upper = p.dominant
    ? (p.tensions.find((x) => [6, 8, 9].includes(mod(x - r, 12))) ?? (mod(p.fifth - r, 12) === 7 ? mod(r + 9, 12) : p.fifth))
    : p.fifth
  return [
    [t, upper, s, nine],
    [s, nine, t, upper],
  ]
}

/** Stacks a pitch-class list upwards from a lowest note within [lo, lo + 12). */
function stack(pcs: number[], lo: number): number[] {
  const out: number[] = []
  let n = lo + mod(pcs[0]! - lo, 12)
  out.push(n)
  for (const p of pcs.slice(1)) {
    n = n + 1 + mod(p - n - 1, 12)
    out.push(n)
  }
  return out
}

function cost(v: number[], prev: number[] | null): number {
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  if (!prev || prev.length === 0) return Math.abs(mean - 62)
  if (prev.length === v.length) return v.reduce((a, n, i) => a + Math.abs(n - prev[i]!), 0)
  const pm = prev.reduce((a, b) => a + b, 0) / prev.length
  return Math.abs(mean - pm) * v.length
}

/** The voicing of `c` nearest `prev` (lowest voice first). */
export function voice(c: Chord, prev: number[] | null, style: BarCtx['style'], jitter = 0): number[] {
  const p = chordPcs(c)
  if (style === 'drone') {
    const root = 48 + mod(p.root - 48, 12)
    return [root, root + mod(p.fifth - p.root, 12), root + 12]
  }
  let best: number[] = []
  let bestCost = Infinity
  for (const shape of voicingShapes(p, style)) {
    for (const lo of [LOWEST - 2, LOWEST + 4, LOWEST + 10]) {
      const v = stack(shape, lo)
      if (v[0]! < LOWEST - 2 || v[v.length - 1]! > TOP) continue
      const k = cost(v, prev) + jitter * Math.abs(Math.sin(v[0]! * 7.1))
      if (k < bestCost) {
        bestCost = k
        best = v
      }
    }
  }
  return best
}

function hitsFor(ctx: BarCtx, beats: number, odd: boolean): Hit[] {
  const r = ctx.rng
  if (ctx.style === 'swing' && beats === 4)
    return pick(r, [
      [[0, 0.7], [1.5, 0.45]],
      [[1.5, 0.45], [3.5, 0.45]],
      [[0, 0.45], [2.5, 0.7]],
      [[1, 0.45], [2.5, 0.45]],
      [[2.5, 0.9]],
      [[0, 1.6], [2, 1.6]],
      [[0.5, 0.45], [2, 0.45], [3.5, 0.4]],
    ] as Hit[][])
  if (ctx.style === 'waltz' || (ctx.style === 'swing' && beats === 3))
    return pick(r, [[[0, 0.9]], [[1, 0.45], [2, 0.45]], [[0, 0.5], [1.5, 0.5]], [[1.5, 1.2]]] as Hit[][])
  if (ctx.style === 'bossa' && beats === 4)
    return odd
      ? [[0.5, 1.1], [2, 1], [3.5, 0.45]]
      : [[0, 1.2], [1.5, 1.2], [3, 0.6]]
  if (ctx.style === 'pop' && beats === 4)
    return pick(r, [
      [[0, 0.9], [1, 0.9], [2, 0.9], [3, 0.9]],
      [[0, 1.4], [1.5, 0.45], [2, 1.4], [3.5, 0.45]],
      [[0, 1.9], [2, 1.9]],
    ] as Hit[][])
  if (ctx.style === 'funk' && beats === 4)
    return pick(r, [
      [[0, 0.2], [0.75, 0.2], [1.5, 0.25], [2.25, 0.2], [3, 0.2], [3.75, 0.15]],
      [[0.5, 0.2], [1.25, 0.2], [2.5, 0.25], [3.5, 0.2]],
    ] as Hit[][])
  // other meters: a chord on each beat (pop, funk, bossa) or on the downbeat
  if (ctx.style === 'pop' || ctx.style === 'funk' || ctx.style === 'bossa')
    return Array.from({ length: beats }, (_, i) => [i, 0.8] as Hit)
  return [[0, Math.min(beats, 2) * 0.8]]
}

const VEL: Record<BarCtx['style'], number> = { swing: 0.5, waltz: 0.48, ballad: 0.5, bossa: 0.45, pop: 0.52, funk: 0.55, drone: 0.4 }

/** One bar of piano. `prev` is the last voicing (null after a seek); returns this bar's last voicing. */
export function pianoBar(ctx: BarCtx, prev: number[] | null): { events: NoteEvent[]; last: number[] | null } {
  const bar = ctx.form.bars[ctx.barIndex]!
  const out: NoteEvent[] = []
  let last = prev
  const play = (c: FormChord, b: number, dur: number, vel: number, roll = 0) => {
    if (!c.chord) return
    const v = voice(c.chord, last, ctx.style, 2)
    v.forEach((m, i) =>
      out.push({ part: 'piano', beat: bar.startBeat + b + i * roll, midi: m, vel: vel * (0.92 + ctx.rng() * 0.16), dur }),
    )
    last = v
  }

  if (ctx.style === 'ballad' || ctx.style === 'drone') {
    for (const c of bar.chords) play(c, c.beat, c.beats - 0.05, VEL[ctx.style], ctx.style === 'ballad' ? 0.04 : 0)
    return { events: out, last }
  }

  const hits = hitsFor(ctx, bar.beats, ctx.barIndex % 2 === 1)
  const played = new Set<FormChord>()
  const resolved = hits.map(([b, dur]) => {
    // an off-beat just before a change anticipates the next chord (pushes into the bar line, too)
    const { cur, next } = chordAt(ctx.form, ctx.barIndex, b)
    const nextStart = cur ? cur.beat + cur.beats : Infinity
    const anticip = b % 1 !== 0 && next && Math.abs(Math.ceil(b) - nextStart) < 1e-9
    return { b, dur, c: anticip ? next : cur }
  })
  for (const r of resolved) if (r.c) played.add(r.c)
  // every chord that starts in this bar sounds at least once
  for (const c of bar.chords)
    if (c.chord && !played.has(c)) resolved.push({ b: c.beat, dur: Math.min(c.beats, 1.5) * 0.8, c })
  resolved.sort((a, b) => a.b - b.b)
  for (const r of resolved) if (r.c) play(r.c, swung(r.b, ctx.swing), r.dur, VEL[ctx.style] * (r.b === 0 ? 1.08 : 1))
  return { events: out, last }
}
