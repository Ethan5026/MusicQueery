// Chord vocabulary, template emissions on bass + treble chroma, and the beat-level HMM (Viterbi offline,
// forward filtering + fixed-lag smoothing live). Pop comes first (D-36): triads are the default reading and a
// seventh has to earn its place, and changes inside the running key are preferred over chromatic ones.
import { family, parseChord, pc } from '@mq/theory'

export type Quality = 'maj' | 'min' | '7' | 'maj7' | 'min7'

export const QUALITIES: { q: Quality; tones: number[]; text: string }[] = [
  { q: 'maj', tones: [0, 4, 7], text: '' },
  { q: 'min', tones: [0, 3, 7], text: 'm' },
  { q: '7', tones: [0, 4, 7, 10], text: '7' },
  { q: 'maj7', tones: [0, 4, 7, 11], text: 'maj7' },
  { q: 'min7', tones: [0, 3, 7, 10], text: 'm7' },
]

export interface ChordState {
  /** pitch class of the root, -1 for N.C. */
  root: number
  q: Quality | null
  tones: number[]
}

/** State 0 is N.C.; then root-major order over QUALITIES. */
export const STATES: ChordState[] = [
  { root: -1, q: null, tones: [] },
  ...QUALITIES.flatMap(({ q, tones }) =>
    Array.from({ length: 12 }, (_, r) => ({ root: r, q, tones: tones.map((t) => (t + r) % 12) })),
  ),
]
export const NC_STATE = 0

const NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

/** The decoder state nearest a chord symbol (C9 → C7, Cm6 → Cm, C° → Cm, Csus4 → C); N.C. or unreadable → NC_STATE. */
export function stateOfSymbol(symbol: string): number {
  const c = parseChord(symbol)
  if (!c || c.kind !== 'chord') return NC_STATE
  const f = family(c)
  const q: Quality =
    f === 'dom'
      ? '7'
      : f === 'min' || f === 'half' || f === 'dim'
        ? c.seventh === 'min' && f === 'min'
          ? 'min7'
          : 'min'
        : f === 'maj' && c.seventh === 'maj'
          ? 'maj7'
          : 'maj'
  const qi = QUALITIES.findIndex((x) => x.q === q)
  return 1 + qi * 12 + pc(c.root)
}
/** Neutral spelling (`@mq/theory` respells in key later). */
export function stateText(s: number): string {
  const c = STATES[s]!
  if (c.root < 0) return 'N.C.'
  return NAMES[c.root] + QUALITIES.find((x) => x.q === c.q)!.text
}

export interface EmissionParams {
  /** weight of the treble cosine */
  treble: number
  /** weight of the bass root share */
  bass: number
  /** log prior of a seventh chord against its triad */
  seventh: number
  /** treble cosine an N.C. is credited with */
  ncCos: number
  /** frames quieter than this (dBFS) count as silence */
  silenceDb: number
}

export const DEFAULT_EMISSION: EmissionParams = { treble: 20, bass: 8, seventh: -0.6, ncCos: 0.45, silenceDb: -60 }

/** Template vectors per state, unit length (treble). A 7th weighs a little less than the triad's tones. Profiles
 *  learned from the truth set (mean chroma per quality, leave-one-song-out) scored no better: majmin 65.9 vs 65.7. */
const TEMPLATES: Float32Array[] = STATES.map((c) => {
  const v = new Float32Array(12)
  for (const t of c.tones) v[t] = 1
  if (c.q === '7' || c.q === 'maj7' || c.q === 'min7') v[c.tones[3]!] = 0.8
  const n = Math.hypot(...v)
  if (n > 0) for (let i = 0; i < 12; i++) v[i]! /= n
  return v
})

export interface BeatFeature {
  bass: Float32Array
  treble: Float32Array
  db: number
}

/** Log-likelihood of every state for one beat's chroma. */
export function emissions(f: BeatFeature, p: EmissionParams = DEFAULT_EMISSION, out = new Float32Array(STATES.length)): Float32Array {
  const tn = Math.hypot(...f.treble)
  let bsum = 0
  for (let i = 0; i < 12; i++) bsum += f.bass[i]!
  if (tn <= 1e-9 || f.db < p.silenceDb) {
    out.fill(-20)
    out[NC_STATE] = 0
    return out
  }
  out[NC_STATE] = p.treble * p.ncCos + p.bass * Math.log(1 / 12 + 0.05)
  for (let s = 1; s < STATES.length; s++) {
    const t = TEMPLATES[s]!
    let dot = 0
    for (let i = 0; i < 12; i++) dot += t[i]! * f.treble[i]!
    const share = bsum > 1e-9 ? f.bass[STATES[s]!.root]! / bsum : 1 / 12
    const q = STATES[s]!.q
    const prior = q === 'maj' || q === 'min' ? 0 : p.seventh
    out[s] = p.treble * (dot / tn) + p.bass * Math.log(share + 0.05) + prior
  }
  return out
}

// ---------------------------------------------------------------- transitions

export interface TransitionParams {
  /** probability of staying on the same chord from one beat to the next */
  stay: number
  /** weight of a change that stays inside the running key against one outside it (0..1, 1 = no preference) */
  outside: number
}

export const DEFAULT_TRANSITION: TransitionParams = { stay: 0.85, outside: 0.35 }

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
/** Diatonic triads/sevenths of a major key (and its relative minor), as state sets, per tonic pc. */
const DIATONIC: Set<number>[] = Array.from({ length: 12 }, (_, k) => {
  const scale = new Set(MAJOR.map((d) => (d + k) % 12))
  const set = new Set<number>()
  STATES.forEach((c, s) => {
    if (c.root >= 0 && c.tones.every((t) => scale.has(t))) set.add(s)
  })
  // common pop borrowings: ♭VII and IV of the parallel minor stay cheap (♭VII major, iv minor)
  const bVII = (k + 10) % 12
  const iv = (k + 5) % 12
  STATES.forEach((c, s) => {
    if ((c.root === bVII && c.q === 'maj') || (c.root === iv && c.q === 'min')) set.add(s)
    // V7 of the relative minor (E7 in C) — Let It Be, countless ballads
    if (c.root === (k + 4) % 12 && (c.q === 'maj' || c.q === '7')) set.add(s)
  })
  return set
})

/** Log prior of moving into each state, given the key weights (12 major tonics, summing to 1). */
export function changePrior(keyWeights: ArrayLike<number> | null, p: TransitionParams = DEFAULT_TRANSITION): Float32Array {
  const S = STATES.length
  const w = new Float32Array(S)
  if (!keyWeights) {
    w.fill(1)
  } else {
    for (let s = 0; s < S; s++) {
      let v = 0
      for (let k = 0; k < 12; k++) v += keyWeights[k]! * (DIATONIC[k]!.has(s) ? 1 : p.outside)
      w[s] = v
    }
    w[NC_STATE] = p.outside
  }
  let sum = 0
  for (let s = 0; s < S; s++) sum += w[s]!
  for (let s = 0; s < S; s++) w[s] = Math.log(w[s]! / sum)
  return w
}

/**
 * Offline Viterbi over beats. `priors[b]` (optional) is the change prior to use at beat b, else uniform.
 * Returns the state per beat.
 */
export function viterbi(
  ll: Float32Array[],
  priors: (Float32Array | null)[] | null,
  p: TransitionParams = DEFAULT_TRANSITION,
): number[] {
  const S = STATES.length
  const T = ll.length
  if (T === 0) return []
  const back: Uint8Array[] = []
  let delta = Float64Array.from(ll[0]!)
  const logStay = Math.log(p.stay)
  const logMove = Math.log(1 - p.stay)
  const uniform = changePrior(null, p)
  for (let t = 1; t < T; t++) {
    const prior = priors?.[t] ?? uniform
    let best = 0
    let second = 1
    for (let s = 1; s < S; s++)
      if (delta[s]! > delta[best]!) {
        second = best
        best = s
      } else if (delta[s]! > delta[second]!) second = s
    const next = new Float64Array(S)
    const bp = new Uint8Array(S)
    for (let s = 0; s < S; s++) {
      const from = best === s ? second : best
      const stay = delta[s]! + logStay
      const move = delta[from]! + logMove + prior[s]!
      if (stay >= move) {
        next[s] = stay + ll[t]![s]!
        bp[s] = s
      } else {
        next[s] = move + ll[t]![s]!
        bp[s] = from
      }
    }
    back.push(bp)
    delta = next
  }
  let s = 0
  for (let i = 1; i < S; i++) if (delta[i]! > delta[s]!) s = i
  const path = new Array<number>(T)
  path[T - 1] = s
  for (let t = T - 1; t > 0; t--) {
    s = back[t - 1]![s]!
    path[t - 1] = s
  }
  return path
}
