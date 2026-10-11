// Key regions: Viterbi over the 24 keys. Each chord scores by its harmonic function in a key
// (diatonic, secondary dominant resolving, borrowed…); every key change costs a fixed penalty.
import { type ChordSymbol, family } from './chord'
import { type HarmonicFunction, type Key, MINOR_SHARED, harmonicFunction } from './numeral'
import { type Note, mod, pc, spell } from './pitch'

export interface RegionInput {
  chord: ChordSymbol
  beats: number
}

export interface RegionOptions {
  /** Prior for the first chord, e.g. the chart's key */
  home?: Key
  /** The sequence loops (a form played again): the last chord's next is the first */
  cyclic?: boolean
}

const CHANGE_PENALTY = 4
const HOME_PRIOR = 1

const MAJOR_NAMES = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6] // C D♭ D E♭ E F G♭ G A♭ A B♭ B
const MINOR_NAMES = [0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 6, 6] // C C♯ D E♭ E F F♯ G G♯ A B♭ B

const ALL_KEYS: Array<{ tonicPc: number; mode: Key['mode'] }> = []
for (const mode of ['major', 'minor'] as const) for (let p = 0; p < 12; p++) ALL_KEYS.push({ tonicPc: p, mode })

const keyOf = (k: { tonicPc: number; mode: Key['mode'] }): Key => ({
  tonic: spell((k.mode === 'major' ? MAJOR_NAMES : MINOR_NAMES)[k.tonicPc]!, k.tonicPc),
  mode: k.mode,
})

function emission(fn: HarmonicFunction, c: ChordSymbol, prev: ChordSymbol | null, next: ChordSymbol | null, k: Key): number {
  if (c.kind === 'nc') return 0
  const d = mod(pc(c.root) - pc(k.tonic), 12)
  const f = family(c)
  switch (fn.kind) {
    case 'diatonic': {
      let s = 2
      if (d === 0) s += 1
      if (k.mode === 'minor' && MINOR_SHARED.has(d)) s *= 0.85
      // cadence: V7 → I, and I preceded by V7
      if (d === 7 && f === 'dom' && next?.kind === 'chord' && mod(pc(next.root) - pc(k.tonic), 12) === 0) s += 1
      if (d === 0 && prev?.kind === 'chord' && family(prev) === 'dom' && mod(pc(prev.root) - pc(k.tonic), 12) === 7) s += 1
      return s
    }
    case 'secondary':
      // a dominant on the tonic of a major key (blues I7, or V7/IV) still says "home"
      if (k.mode === 'major' && d === 0) return 2.2
      return fn.resolves ? 1.5 : 0.6
    case 'relatedii':
      return fn.resolves ? 1.5 : 0.6
    case 'subV':
      return 1.2
    case 'passing':
    case 'leading':
      return 1.5
    case 'blues':
      return d === 0 ? 2.2 : 1.8
    case 'borrowed':
      return 0.6
    default:
      return -1
  }
}

const weight = (beats: number): number => Math.min(1.5, Math.max(0.5, Math.sqrt(beats / 4)))

export interface Region {
  start: number
  end: number
  key: Key
}

/** Key for every chord, and the same as contiguous regions (index ranges, end exclusive). */
export function detectKeys(items: RegionInput[], opts: RegionOptions = {}): { keys: Key[]; regions: Region[] } {
  const n = items.length
  if (n === 0) return { keys: [], regions: [] }
  const K = ALL_KEYS.length
  const at = (i: number): ChordSymbol | null =>
    i >= 0 && i < n ? items[i]!.chord : opts.cyclic ? items[mod(i, n)]!.chord : null
  const keys = ALL_KEYS.map(keyOf)
  const score: Float64Array[] = []
  const back: Int16Array[] = []
  for (let i = 0; i < n; i++) {
    const c = items[i]!.chord
    const em = new Float64Array(K)
    for (let k = 0; k < K; k++) {
      const fn = harmonicFunction(at(i - 1), c, at(i + 1), keys[k]!, at(i + 2))
      em[k] = emission(fn, c, at(i - 1), at(i + 1), keys[k]!) * weight(items[i]!.beats)
    }
    const s = new Float64Array(K)
    const b = new Int16Array(K)
    for (let k = 0; k < K; k++) {
      if (i === 0) {
        const home = opts.home && pc(opts.home.tonic) === ALL_KEYS[k]!.tonicPc && opts.home.mode === ALL_KEYS[k]!.mode
        s[k] = em[k]! + (home ? HOME_PRIOR : 0)
        continue
      }
      const prev = score[i - 1]!
      let best = k
      let bestScore = prev[k]!
      for (let j = 0; j < K; j++) {
        const v = prev[j]! - CHANGE_PENALTY
        if (v > bestScore) {
          bestScore = v
          best = j
        }
      }
      s[k] = bestScore + em[k]!
      b[k] = best
    }
    score.push(s)
    back.push(b)
  }
  const last = score[n - 1]!
  let k = 0
  for (let j = 1; j < K; j++) if (last[j]! > last[k]!) k = j
  const path = new Array<number>(n)
  for (let i = n - 1; i >= 0; i--) {
    path[i] = k
    k = back[i]![k]!
  }
  const regions: Region[] = []
  for (let i = 0; i < n; i++) {
    const r = regions[regions.length - 1]
    if (r && ALL_KEYS[path[i]!] === ALL_KEYS[path[r.start]!]) r.end = i + 1
    else regions.push({ start: i, end: i + 1, key: keys[path[i]!]! })
  }
  for (const r of regions) r.key = spellTonic(r.key, items.slice(r.start, r.end))
  const out: Key[] = []
  for (const r of regions) for (let i = r.start; i < r.end; i++) out.push(r.key)
  return { keys: out, regions }
}

/** Uses the chart's own spelling of the tonic when a chord in the region has that root. */
function spellTonic(k: Key, items: RegionInput[]): Key {
  const p = pc(k.tonic)
  const counts = new Map<string, { n: Note; c: number }>()
  for (const { chord } of items) {
    if (chord.kind !== 'chord' || pc(chord.root) !== p || Math.abs(chord.root.acc) > 1) continue
    const id = `${chord.root.letter}:${chord.root.acc}`
    const e = counts.get(id) ?? { n: chord.root, c: 0 }
    e.c++
    counts.set(id, e)
  }
  let best: { n: Note; c: number } | null = null
  for (const e of counts.values()) if (!best || e.c > best.c) best = e
  return best ? { tonic: best.n, mode: k.mode } : k
}
