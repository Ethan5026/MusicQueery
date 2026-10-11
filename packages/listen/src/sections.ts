// Sections from chord repetition (M7, P-05): bars that repeat elsewhere, as diagonal stripes of a bar-level
// self-similarity of the chords, vote for boundaries where the stripes start and end; the stretches between are
// lettered A, B, C… by how alike their chords are. Harmony only, so it cannot split a verse from a chorus that
// share their chords (Let It Be); a linked chart's rehearsal marks are better where there is one.
import type { Timeline } from '@mq/model'
import { effectiveChords } from '@mq/theory'
import { STATES, stateOfSymbol } from './chords'

export interface Section {
  startMs: number
  label: string
}

export interface SectionOptions {
  /** bar similarity a repeat needs (share of beats with the same root and third) */
  same?: number
  /** shortest repeat, bars */
  minBars?: number
}

const triad = (s: number): number => {
  const c = STATES[s]!
  return c.root < 0 ? -1 : c.root * 2 + (c.q === 'min' || c.q === 'min7' ? 1 : 0)
}

/** Root+third token per beat of each bar. */
function barTokens(tl: Timeline): number[][] {
  const chords = effectiveChords(tl)
  const bars = tl.bars
  const out: number[][] = []
  const at = (t: number): number => {
    let lo = 0
    let hi = chords.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const c = chords[mid]!
      if (t < c.startMs) hi = mid - 1
      else if (t >= c.endMs) lo = mid + 1
      else return triad(stateOfSymbol(c.symbol))
    }
    return -1
  }
  for (let i = 0; i < bars.length; i++) {
    const a = bars[i]!.startMs
    const b = bars[i + 1]?.startMs ?? tl.durationMs
    out.push([0, 1, 2, 3].map((k) => at(a + ((k + 0.5) * (b - a)) / 4)))
  }
  return out
}

const sim = (a: number[], b: number[]): number => {
  let s = 0
  for (let k = 0; k < a.length; k++) if (a[k] === b[k] && a[k] !== -1) s++
  return s / a.length
}

export function findSections(tl: Timeline, o: SectionOptions = {}): Section[] {
  const same = o.same ?? 0.75
  const minBars = o.minBars ?? 4
  const toks = barTokens(tl)
  const n = toks.length
  if (n < 2 * minBars) return []
  const votes = new Float32Array(n + 1)
  // stripes: runs along each diagonal where bars match (one stray bar allowed once a run is 2 bars long)
  for (let lag = minBars; lag < n; lag++) {
    let start = -1
    let miss = 0
    for (let i = lag; i <= n; i++) {
      const ok = i < n && sim(toks[i]!, toks[i - lag]!) >= same
      if (ok) {
        if (start < 0) start = i
        miss = 0
      } else if (start >= 0 && i - start >= 2 && i < n && miss === 0 && i + 1 < n && sim(toks[i + 1]!, toks[i + 1 - lag]!) >= same) {
        // one stray bar inside an established repeat (not alternating coincidences)
        miss = 1
      } else if (start >= 0) {
        const end = i - (miss ? 1 : 0)
        // longer repeats are surer: a vote weighs the stripe's length in units of minBars
        if (end - start >= minBars) {
          for (const at of [start, end, start - lag, end - lag]) votes[at]! += (end - start) / minBars
        }
        start = -1
        miss = 0
      }
    }
  }
  // boundaries: the best-voted bars, at least `minBars` apart. A stripe that starts a bar early (a chord shared by
  // chance) splits its vote; spreading votes to neighbours fixed that case but scored worse on the truth set.
  const cand = [...votes.keys()].filter((i) => i > 0 && i < n && votes[i]! >= 3).sort((a, b) => votes[b]! - votes[a]!)
  const picked: number[] = [0]
  for (const i of cand) if (picked.every((p) => Math.abs(p - i) >= minBars)) picked.push(i)
  picked.sort((a, b) => a - b)
  // letters: a segment takes the letter of the first earlier segment whose chords it matches
  const segs = picked.map((s, k) => ({ s, e: picked[k + 1] ?? n }))
  const labels: string[] = []
  segs.forEach((seg, k) => {
    for (let m = 0; m < k; m++) {
      const o2 = segs[m]!
      const len = Math.min(seg.e - seg.s, o2.e - o2.s)
      let acc = 0
      for (let i = 0; i < len; i++) acc += sim(toks[seg.s + i]!, toks[o2.s + i]!)
      if (len >= 2 && acc / len >= same) {
        labels[k] = labels[m]!
        return
      }
    }
    labels[k] = String.fromCharCode(65 + new Set(labels).size)
  })
  return segs.map((seg, k) => ({ startMs: tl.bars[seg.s]!.startMs, label: labels[k]! }))
}

/** Boundary F-measure within ±`tol` ms (MIREX segmentation; the first boundary is not counted). */
export function boundaryF(ref: number[], est: number[], tol = 3000): number {
  const r = ref.slice(1)
  const e = est.slice(1)
  if (!r.length || !e.length) return 0
  const used = new Set<number>()
  let hits = 0
  for (const t of r) {
    const k = e.findIndex((x, i) => !used.has(i) && Math.abs(x - t) <= tol)
    if (k >= 0) {
      used.add(k)
      hits++
    }
  }
  const p = hits / e.length
  const rc = hits / r.length
  return p + rc ? (2 * p * rc) / (p + rc) : 0
}
