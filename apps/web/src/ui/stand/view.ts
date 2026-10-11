// Per-timeline facts the Stand shows beside theory.moment(): home key, tempo, bar and section labels.
import type { Timeline } from '@mq/model'
import { type InstrumentId, type MomentKey, note, noteName, toWritten } from '@mq/theory'

interface Info {
  /** concert-pitch home key: the key held longest */
  home: MomentKey | null
  /** the repeated span of chart bars (a chorus), when the timeline came from a chart */
  form: { start: number; length: number } | null
  lastBar: number
}

const cache = new WeakMap<Timeline, Info>()

function info(tl: Timeline): Info {
  const hit = cache.get(tl)
  if (hit) return hit
  const held = new Map<string, number>()
  for (const k of tl.keys) {
    const id = `${k.tonic}|${k.mode}`
    held.set(id, (held.get(id) ?? 0) + (k.endMs - k.startMs))
  }
  let best: string | null = null
  for (const [id, ms] of held) if (best === null || ms > held.get(best)!) best = id
  const [tonic, mode] = best ? best.split('|') : []

  const seen = new Map<number, number>()
  for (const b of tl.bars) if (b.chartBar !== undefined) seen.set(b.chartBar, (seen.get(b.chartBar) ?? 0) + 1)
  const repeated = [...seen].filter(([, n]) => n > 1).map(([i]) => i)
  const form = repeated.length
    ? { start: Math.min(...repeated), length: Math.max(...repeated) - Math.min(...repeated) + 1 }
    : null

  const out: Info = {
    home: tonic && mode ? { tonic, mode: mode as MomentKey['mode'] } : null,
    form,
    lastBar: tl.bars.at(-1)?.number ?? 0,
  }
  cache.set(tl, out)
  return out
}

/** The tune's home key, written for the instrument. */
export function homeKey(tl: Timeline, inst: InstrumentId): MomentKey | null {
  const h = info(tl).home
  return h ? { tonic: noteName(toWritten(note(h.tonic), inst)), mode: h.mode } : null
}

export const keyText = (k: MomentKey): string => `${k.tonic} ${k.mode}`

/** Tempo in effect at `ms`, rounded. */
export function tempoAt(tl: Timeline, ms: number): number | null {
  let bpm: number | null = null
  for (const t of tl.tempo) if (t.startMs <= ms + 1) bpm = t.bpm
  return bpm === null ? null : Math.round(bpm)
}

export function barIndexAt(tl: Timeline, ms: number): number {
  let i = -1
  for (let lo = 0, hi = tl.bars.length - 1; lo <= hi; ) {
    const mid = (lo + hi) >> 1
    if (tl.bars[mid]!.startMs <= ms) {
      i = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return i
}

/** "Bar 7 / 36": the bar within the chorus for charts, else within the track. */
export function barPosition(tl: Timeline, barIndex: number): { n: number; total: number } | null {
  const b = tl.bars[barIndex]
  if (!b) return null
  const { form, lastBar } = info(tl)
  if (form && b.chartBar !== undefined && b.chartBar >= form.start && b.chartBar < form.start + form.length)
    return { n: b.chartBar - form.start + 1, total: form.length }
  return { n: b.number, total: lastBar }
}

/** "A2 · ch 3" for a repeated chart section, "Intro" for a single pass, null without sections (P-05). */
export function sectionLabel(tl: Timeline, barIndex: number): string | null {
  const b = tl.bars[barIndex]
  if (!b?.section) return null
  const { form } = info(tl)
  const inForm = form && b.chartBar !== undefined && b.chartBar >= form.start && b.chartBar < form.start + form.length
  return inForm && b.pass ? `${b.section} · ch ${b.pass}` : b.section
}
