// Drums by style: ride "ding ding-a" with the hi-hat foot on 2 and 4 and a feathered kick in swing; brushes-soft ride
// and cross-stick in ballads; the bossa cross-stick pattern over steady eighths; backbeat grooves in pop and funk.
// A crash marks the top of each section, and a short fill ends the bar before it.
import { type BarCtx, type DrumEvent, type DrumPiece, swung } from './types'

type Hit = readonly [beat: number, piece: DrumPiece, vel: number]

function groove(ctx: BarCtx, beats: number, odd: boolean): Hit[] {
  const h: Hit[] = []
  const each = (piece: DrumPiece, vel: number, step = 1, from = 0) => {
    for (let b = from; b < beats - 1e-9; b += step) h.push([b, piece, vel])
  }
  switch (ctx.style) {
    case 'swing':
      for (let b = 0; b < beats; b++) {
        h.push([b, 'ride', b % 2 === 0 ? 0.55 : 0.62])
        if (b % 2 === 1) h.push([b + 0.5, 'ride', 0.42])
        if (b % 2 === 1) h.push([b, 'hhfoot', 0.55])
        h.push([b, 'kick', 0.18])
      }
      // a comping snare now and then
      if (ctx.rng() < 0.45) h.push([Math.floor(ctx.rng() * beats) + 0.5, 'ghost', 0.3 + ctx.rng() * 0.15])
      break
    case 'waltz':
      h.push([0, 'ride', 0.58], [1, 'ride', 0.55], [1.5, 'ride', 0.4], [2, 'ride', 0.55])
      h.push([1, 'hhfoot', 0.45], [2, 'hhfoot', 0.45], [0, 'kick', 0.25])
      break
    case 'ballad':
      each('ride', 0.36)
      for (let b = 1; b < beats; b += 2) h.push([b, 'hhfoot', 0.4])
      if (beats === 4) h.push([3, 'xstick', 0.35])
      break
    case 'bossa':
      each('hhclosed', 0.22, 0.5)
      for (const b of odd ? [1, 2.5] : [0, 1.5, 3]) if (b < beats) h.push([b, 'xstick', 0.5])
      for (const b of [0, 1.5, 2, 3.5]) if (b < beats) h.push([b, 'kick', b % 1 ? 0.3 : 0.45])
      break
    case 'pop':
      for (let b = 0; b < beats; b += 0.5) h.push([b, 'hhclosed', b % 1 ? 0.3 : 0.45])
      for (const b of [0, 2, 2.5]) if (b < beats) h.push([b, 'kick', b % 1 ? 0.55 : 0.75])
      for (let b = 1; b < beats; b += 2) h.push([b, 'snare', 0.7])
      break
    case 'funk':
      for (let b = 0; b < beats; b += 0.25) h.push([b, 'hhclosed', b % 0.5 ? 0.18 : b % 1 ? 0.3 : 0.42])
      for (const b of [0, 0.75, 2.5]) if (b < beats) h.push([b, 'kick', 0.75])
      for (let b = 1; b < beats; b += 2) h.push([b, 'snare', 0.75])
      for (const b of [1.75, 2.25, 3.75]) if (b < beats && ctx.rng() < 0.6) h.push([b, 'ghost', 0.22])
      break
    case 'drone':
      break
  }
  return h
}

function fill(ctx: BarCtx, beats: number): Hit[] {
  if (ctx.style === 'drone' || ctx.style === 'ballad') return []
  const last = beats - 1
  if (ctx.style === 'pop' || ctx.style === 'funk')
    return [[last, 'snare', 0.55], [last + 0.25, 'snare', 0.45], [last + 0.5, 'snare', 0.6], [last + 0.75, 'snare', 0.7]]
  // swing, waltz, bossa: a two-note setup into the top of the section
  return [[last - 0.5, 'snare', 0.45], [last + 0.5, 'snare', 0.6], [last + 0.5, 'kick', 0.5]]
}

/** One bar of drums. */
export function drumBar(ctx: BarCtx): DrumEvent[] {
  const bar = ctx.form.bars[ctx.barIndex]!
  const next = ctx.form.bars[ctx.barIndex + 1]
  const top = ctx.barIndex === 0 || (bar.section !== undefined && bar.section !== ctx.form.bars[ctx.barIndex - 1]?.section) || bar.pass !== ctx.form.bars[ctx.barIndex - 1]?.pass
  const hits = groove(ctx, bar.beats, ctx.barIndex % 2 === 1)
  if (top && ctx.style !== 'drone' && ctx.style !== 'ballad') hits.push([0, 'crash', 0.5], [0, 'kick', 0.6])
  const nextTop = next && ((next.section !== undefined && next.section !== bar.section) || next.pass !== bar.pass)
  if (nextTop) {
    const f = fill(ctx, bar.beats)
    if (f.length) {
      // the fill replaces the backbeat it lands on
      const from = Math.min(...f.map((x) => x[0]))
      const kept = hits.filter((x) => x[0] < from - 1e-9 || x[1] === 'ride' || x[1] === 'hhfoot' || x[1] === 'hhclosed')
      hits.length = 0
      hits.push(...kept, ...f)
    }
  }
  return hits.map(([b, piece, vel]) => ({ part: 'drums', beat: bar.startBeat + swung(b, ctx.swing), piece, vel }))
}

/** A count-in: cross-stick on every beat, the first of each bar louder. Beats are negative (before the form). */
export function countIn(bars: number, beatsPerBar: number): DrumEvent[] {
  const out: DrumEvent[] = []
  const n = bars * beatsPerBar
  for (let i = 0; i < n; i++) out.push({ part: 'drums', beat: i - n, piece: 'xstick', vel: i % beatsPerBar === 0 ? 0.85 : 0.6 })
  return out
}
