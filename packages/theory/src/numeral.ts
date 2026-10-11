// Keys, Roman numerals and harmonic function: diatonic, secondary dominants and their ii,
// tritone subs, borrowed (modal interchange), passing and leading-tone diminished chords.
import { type Chord, type ChordSymbol, type Family, family } from './chord'
import { type Note, mod, noteName, note, pc } from './pitch'

export type Mode = 'major' | 'minor'

export interface Key {
  tonic: Note
  mode: Mode
}

export const key = (tonic: string, mode: Mode = 'major'): Key => ({ tonic: note(tonic), mode })
export const keyName = (k: Key): string => noteName(k.tonic) + (k.mode === 'minor' ? ' minor' : ' major')
export const sameKey = (a: Key, b: Key): boolean => pc(a.tonic) === pc(b.tonic) && a.mode === b.mode

/** Semitones from the key's relative-major tonic: the sketch's region degree. */
export const majorDegree = (rootPc: number, k: Key): number => mod(rootPc - pc(k.tonic) - (k.mode === 'minor' ? 3 : 0), 12)

const RN = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII']

function numeralSuffix(c: Chord): string {
  const f = family(c)
  switch (f) {
    case 'maj':
      return c.seventh === 'maj' ? (c.fifth === '#' ? '+maj7' : 'maj7') : c.seventh === 'six' ? '6' : ''
    case 'min':
      return c.seventh === 'min' ? '7' : c.seventh === 'six' ? '6' : c.seventh === 'maj' ? 'maj7' : ''
    case 'dom':
      return (c.fifth === '#' && !c.alt ? '+7' : '7') + (c.third === 'sus4' || c.third === 'sus2' ? 'sus' : '')
    case 'half':
      return 'ø7'
    case 'dim':
      return c.seventh === 'dim' ? '°7' : c.seventh === 'maj' ? '°maj7' : '°'
    case 'aug':
      return '+'
    case 'sus':
      return 'sus'
    case 'power':
      return '5'
  }
}

const lowerFamily = (f: Family): boolean => f === 'min' || f === 'half' || f === 'dim'

/** Plain Roman numeral of a chord in a key: the sketch's roman(), extended to every family. */
export function romanNumeral(c: Chord, k: Key): string {
  const d = mod(pc(c.root) - pc(k.tonic), 12)
  const base = RN[d]!
  return (lowerFamily(family(c)) ? base.toLowerCase() : base) + numeralSuffix(c)
}

// Diatonic seventh-chord families by degree from the tonic.
type Fit = (c: Chord, f: Family) => boolean
const isMajTonic: Fit = (c, f) => f === 'maj' && c.fifth === 'p'
const isMin: Fit = (c, f) => f === 'min' && c.seventh !== 'maj' && c.fifth === 'p'
const isDom: Fit = (c, f) => f === 'dom' || (f === 'maj' && c.seventh === 'none') || f === 'sus'
const MAJOR_DIATONIC: Record<number, Fit> = {
  0: isMajTonic,
  2: isMin,
  4: isMin,
  5: isMajTonic,
  7: isDom,
  9: isMin,
  11: (c, f) => f === 'half' || (f === 'dim' && c.seventh === 'none'),
}
const MINOR_DIATONIC: Record<number, Fit> = {
  0: (c, f) => f === 'min' && c.fifth === 'p',
  2: (c, f) => f === 'half' || (f === 'dim' && c.seventh === 'none'),
  3: isMajTonic,
  5: isMin,
  7: (c, f) => isDom(c, f) || isMin(c, f),
  8: isMajTonic,
  10: (c, f) => f === 'dom' || (f === 'maj' && c.seventh === 'none'),
  11: (c, f) => f === 'dim',
}
/** Degrees a secondary dominant can target (not the tonic). */
const TARGETS: Record<Mode, number[]> = { major: [2, 4, 5, 7, 9], minor: [3, 5, 7, 8, 10] }
const TARGET_LOWER: Record<Mode, number[]> = { major: [2, 4, 9], minor: [5, 7] }
/** Chords on these minor-key degrees also belong to the relative major. */
export const MINOR_SHARED = new Set([3, 5, 8, 10])

export function isDiatonic(c: Chord, k: Key): boolean {
  const d = mod(pc(c.root) - pc(k.tonic), 12)
  const fit = (k.mode === 'major' ? MAJOR_DIATONIC : MINOR_DIATONIC)[d]
  return fit ? fit(c, family(c)) : false
}

const parallel = (k: Key): Key => ({ tonic: k.tonic, mode: k.mode === 'major' ? 'minor' : 'major' })

export type FunctionKind =
  | 'diatonic' | 'secondary' | 'relatedii' | 'subV' | 'borrowed' | 'passing' | 'leading' | 'blues' | 'chromatic' | 'nc'

export interface HarmonicFunction {
  kind: FunctionKind
  /** Display text, as the sketch writes it: `vi7`, `V7/vi`, `iiø7/vi`, `iv7 borrowed`, `passing °7` */
  text: string
  /** Plain numeral of the chord itself */
  numeral: string
  /** Degree (from the tonic) of the chord this one leads to: secondary, subV, related ii, leading */
  target?: number
  /** A secondary/subV/leading chord whose next chord is its target */
  resolves?: boolean
}

function targetNumeral(targetDeg: number, k: Key, next: ChordSymbol | null, targetPc: number): string {
  let lower = TARGET_LOWER[k.mode].includes(targetDeg)
  if (next?.kind === 'chord' && pc(next.root) === targetPc) lower = lowerFamily(family(next))
  const base = RN[targetDeg]!
  return lower ? base.toLowerCase() : base
}

function dominantFunction(c: Chord, k: Key, next: ChordSymbol | null): HarmonicFunction | null {
  const r = pc(c.root)
  const t = pc(k.tonic)
  const numeral = romanNumeral(c, k)
  const nextRoot = next?.kind === 'chord' ? pc(next.root) : null
  const targetPc = mod(r + 5, 12)
  const targetDeg = mod(targetPc - t, 12)
  // Resolving means landing on a chord of the key (or its parallel), or on the next dominant of a chain
  // (D7 → G7 → C7 → F7 in B♭). D7 → Gmaj7 isn't V7/iii in E♭.
  const resolves =
    nextRoot === targetPc &&
    next?.kind === 'chord' &&
    (isDiatonic(next, k) || isDiatonic(next, parallel(k)) || family(next) === 'dom')
  const secondary = TARGETS[k.mode].includes(targetDeg)
  if (secondary && resolves)
    return { kind: 'secondary', text: 'V7/' + targetNumeral(targetDeg, k, next, targetPc), numeral, target: targetDeg, resolves }
  if (nextRoot !== null && mod(r - nextRoot, 12) === 1 && next?.kind === 'chord' && family(next) !== 'dom') {
    const sd = mod(nextRoot - t, 12)
    const text = sd === 0 ? 'subV7' : 'subV7/' + targetNumeral(sd, k, next, nextRoot)
    return { kind: 'subV', text, numeral, target: sd, resolves: true }
  }
  if (secondary)
    return { kind: 'secondary', text: 'V7/' + targetNumeral(targetDeg, k, null, targetPc), numeral, target: targetDeg, resolves: false }
  return null
}

/**
 * Harmonic function of `c` in key `k`, given its neighbours. Order: N.C., diminished (passing / leading),
 * related ii of a secondary dominant, diatonic, dominant functions, blues I7/IV7, borrowed, chromatic.
 */
export function harmonicFunction(
  prev: ChordSymbol | null,
  c: ChordSymbol,
  next: ChordSymbol | null,
  k: Key,
  nextNext: ChordSymbol | null = null,
): HarmonicFunction {
  if (c.kind === 'nc') return { kind: 'nc', text: 'N.C.', numeral: 'N.C.' }
  const f = family(c)
  const r = pc(c.root)
  const t = pc(k.tonic)
  const d = mod(r - t, 12)
  const numeral = romanNumeral(c, k)
  const pr = prev?.kind === 'chord' ? pc(prev.root) : null
  const nr = next?.kind === 'chord' ? pc(next.root) : null

  if (f === 'dim') {
    const sym = numeralSuffix(c)
    if (pr !== null && nr !== null && ((mod(pr - r, 12) === 1 && mod(r - nr, 12) === 1) || (mod(r - pr, 12) === 1 && mod(nr - r, 12) === 1)))
      return { kind: 'passing', text: 'passing ' + sym, numeral }
    if (nr !== null && mod(nr - r, 12) === 1) {
      const td = mod(nr - t, 12)
      const text = td === 0 ? 'vii' + sym : 'vii' + sym + '/' + targetNumeral(td, k, next, nr)
      return { kind: 'leading', text, numeral, target: td, resolves: true }
    }
  }

  if ((f === 'min' || f === 'half') && next?.kind === 'chord' && nr === mod(r + 5, 12) && family(next) === 'dom') {
    const nf = dominantFunction(next, k, nextNext)
    if (nf && nf.kind === 'secondary' && !(isDiatonic(next, k) && mod(nr - t, 12) === 7)) {
      const of = nf.text.slice(nf.text.indexOf('/') + 1)
      return { kind: 'relatedii', text: 'ii' + numeralSuffix(c) + '/' + of, numeral, target: nf.target!, resolves: nf.resolves! }
    }
  }

  if (isDiatonic(c, k)) return { kind: 'diatonic', text: numeral, numeral }

  if (f === 'dom') {
    const df = dominantFunction(c, k, next)
    if (df) return df
    if (k.mode === 'major' && (d === 0 || d === 5)) return { kind: 'blues', text: numeral, numeral }
  }

  if (isDiatonic(c, parallel(k)) || (d === 1 && f === 'maj'))
    return { kind: 'borrowed', text: numeral + ' borrowed', numeral }

  return { kind: 'chromatic', text: numeral, numeral }
}

