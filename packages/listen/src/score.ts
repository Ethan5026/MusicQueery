// Per-beat chord scores in mir_eval's MIREX rules, ported from the companion's evaluate.py (M3, D-39) so the
// live decoder is measured with the same yardstick: the label at the middle of every truth beat, `root`,
// `majmin` (root + triad; refs that are not maj/min/N excluded) and `sevenths` (root + 7th chord; refs not in
// maj/min/7/maj7/min7/N excluded). Harte labels on both sides; ours come through `@mq/theory`'s `toHarte`.
import { parseChord, toHarte } from '@mq/theory'

const SHORT: Record<string, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  aug: [0, 4, 8],
  dim: [0, 3, 6],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  minmaj7: [0, 3, 7, 11],
  maj6: [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
  dim7: [0, 3, 6, 9],
  hdim7: [0, 3, 6, 10],
  '9': [0, 4, 7, 10],
  maj9: [0, 4, 7, 11],
  min9: [0, 3, 7, 10],
  '11': [0, 4, 7, 10],
  min11: [0, 3, 7, 10],
  '13': [0, 4, 7, 10],
  maj13: [0, 4, 7, 11],
  min13: [0, 3, 7, 10],
  '1': [0],
  '5': [0, 7],
}
const DEGREE = [0, 0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21]
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export interface Encoded {
  /** -1 for N, -2 for X (unknown) */
  root: number
  /** 12-bit semitone set relative to the root */
  bits: number
}

const bitsOf = (xs: number[]): number => xs.reduce((b, x) => b | (1 << x), 0)

export function encodeHarte(label: string): Encoded {
  const s = label.trim()
  if (s === 'N' || s === '') return { root: -1, bits: 0 }
  if (s === 'X') return { root: -2, bits: 0 }
  const m = /^([A-G])([b#]*)(?::([^(/]*))?(?:\(([^)]*)\))?(?:\/(.*))?$/.exec(s)
  if (!m) return { root: -2, bits: 0 }
  let root = LETTER[m[1]!]!
  for (const a of m[2]!) root += a === '#' ? 1 : -1
  root = ((root % 12) + 12) % 12
  const short = m[3]
  let set = new Set<number>(short === undefined ? (m[4] === undefined ? SHORT.maj! : [0]) : short === '' ? [0] : (SHORT[short] ?? [0]))
  if (m[4] !== undefined)
    for (const raw of m[4].split(',')) {
      const t = raw.trim()
      const del = t.startsWith('*')
      const dm = /^\*?([b#]*)(\d+)$/.exec(t)
      if (!dm) continue
      let semi = DEGREE[Number(dm[2])] ?? 0
      for (const a of dm[1]!) semi += a === '#' ? 1 : -1
      if (semi < 0 || semi >= 12) continue // extensions above the octave are dropped, as mir_eval does unreduced
      if (del) set.delete(semi)
      else set.add(semi)
    }
  set = new Set([...set, 0])
  return { root, bits: bitsOf([...set]) }
}

/** Our canonical chord text → Harte (seventh-reduced, via @mq/theory). */
export function symbolToHarte(symbol: string): string {
  const c = parseChord(symbol)
  return c ? toHarte(c) : 'X'
}

const MAJ = bitsOf([0, 4, 7])
const MIN = bitsOf([0, 3, 7])
const SEVENTHS = new Set([MAJ, MIN, bitsOf([0, 4, 7, 10]), bitsOf([0, 4, 7, 11]), bitsOf([0, 3, 7, 10])])
const LOW8 = 0xff

export interface Span {
  startMs: number
  endMs: number
  /** Harte label (truth) */
  harte?: string
  /** our chord text (estimates) */
  symbol?: string
}

function labelAt(spans: Span[], starts: number[], t: number): string {
  let lo = 0
  let hi = starts.length - 1
  if (hi < 0 || t < starts[0]!) return 'X'
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid]! <= t) lo = mid
    else hi = mid - 1
  }
  const sp = spans[lo]!
  if (t >= sp.endMs) return 'X'
  return sp.harte ?? (sp.symbol !== undefined ? symbolToHarte(sp.symbol) : 'X')
}

export interface Scores {
  beats: number
  root: number
  majmin: number
  sevenths: number
  majminN: number
  seventhsN: number
}

/** Scores `est` against `truth` at the middle of each truth beat (truth spans without a chord are skipped). */
export function scoreBeats(truth: Span[], truthBeats: number[], est: Span[]): Scores {
  const ts = truth.map((s) => s.startMs)
  const es = est.map((s) => s.startMs)
  let n = 0
  let root = 0
  let mm = 0
  let mmN = 0
  let sv = 0
  let svN = 0
  for (let i = 0; i + 1 < truthBeats.length; i++) {
    const t = (truthBeats[i]! + truthBeats[i + 1]!) / 2
    const r = encodeHarte(labelAt(truth, ts, t))
    if (r.root === -2) continue
    let h = encodeHarte(labelAt(est, es, t))
    if (h.root === -2) h = { root: -1, bits: 0 }
    n++
    if (r.root === h.root) root++
    const isN = r.root === -1
    if (isN || (r.bits & LOW8) === MAJ || (r.bits & LOW8) === MIN) {
      mmN++
      if (r.root === h.root && (r.bits & LOW8) === (h.bits & LOW8)) mm++
    }
    if (isN || SEVENTHS.has(r.bits)) {
      svN++
      if (r.root === h.root && r.bits === h.bits) sv++
    }
  }
  return { beats: n, root: n ? root / n : 0, majmin: mmN ? mm / mmN : 0, sevenths: svN ? sv / svN : 0, majminN: mmN, seventhsN: svN }
}
