// Turning recogniser output into Timeline chords and keys (M3 companion), and Harte labels for evaluation.
// Recognisers only know pitch classes (C♯ = D♭); D-29 wants spelled notes, so roots are respelled in the
// detected key, the way a lead sheet in that key would write them.
import type { Timeline } from '@mq/model'
import { type Chord, type ChordSymbol, NC, family, formatChord, parseChord } from './chord'
import type { Key } from './numeral'
import { type Note, mod, noteName, pc, spell } from './pitch'
import { detectKeys } from './regions'

/** Letter steps above the tonic for each semitone: ♭2 2 ♭3 3 4 ♯4 5 ♭6 6 ♭7 7 (minor keys use the same names). */
const STEPS = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6]

const DIATONIC = { major: new Set([0, 2, 4, 5, 7, 9, 11]), minor: new Set([0, 2, 3, 5, 7, 8, 10, 11]) }
const WHITE = new Set([0, 2, 4, 5, 7, 9, 11])

/**
 * Spells pitch class `p` in `key` the way a lead sheet would: scale notes by their degree (C♭ in G♭), other
 * white keys by their natural name (E, not F♭, in A♭), other black keys by degree (D♭ in A♭, A♯ in E).
 */
export function spellInKey(p: number, key: Key): Note {
  const d = mod(p - pc(key.tonic), 12)
  if (!DIATONIC[key.mode].has(d) && WHITE.has(mod(p, 12))) return neutral(p)
  const n = spell(key.tonic.letter + STEPS[d]!, p)
  return Math.abs(n.acc) <= 1 ? n : neutral(p)
}

const NEUTRAL: Note[] = STEPS.map((l, p) => spell(l, p))

/** C D♭ D E♭ E F F♯ G A♭ A B♭ B (C major's names): the spelling used before a key is known. */
export const neutral = (p: number): Note => NEUTRAL[mod(p, 12)]!

export function respellInKey<T extends ChordSymbol>(c: T, key: Key): T {
  if (c.kind === 'nc') return c
  const ch = c as Chord
  return { ...ch, root: spellInKey(pc(ch.root), key), bass: ch.bass && spellInKey(pc(ch.bass), key) } as T
}

/**
 * Harte label (mir_eval syntax) reduced to the seventh chord: C9 → C:7, Cm11 → C:min7, C7alt → C:7.
 * 6 chords stay maj6/min6, so MIREX "sevenths" excludes them like ° and ø. No bass, no tensions.
 */
export function toHarte(c: ChordSymbol): string {
  if (c.kind === 'nc') return 'N'
  const root = noteName(c.root, true)
  const f = family(c)
  const q = ((): string => {
    switch (f) {
      case 'power':
        return '5'
      case 'sus':
        return c.third === 'sus2' ? 'sus2' : 'sus4'
      case 'aug':
        return 'aug'
      case 'half':
        return 'hdim7'
      case 'dim':
        return c.seventh === 'dim' ? 'dim7' : c.seventh === 'maj' ? 'dim(7)' : 'dim'
      case 'dom':
        if (c.third === 'sus4' || c.third === 'sus2') return `${c.third}(b7)`
        return c.fifth === '#' ? 'aug(b7)' : '7'
      case 'min':
        return c.seventh === 'six' ? 'min6' : c.seventh === 'min' ? 'min7' : c.seventh === 'maj' ? 'minmaj7' : 'min'
      case 'maj':
        if (c.third === 'sus4' || c.third === 'sus2') return `${c.third}(7)`
        return c.seventh === 'six' ? 'maj6' : c.seventh === 'maj' ? (c.fifth === '#' ? 'aug(7)' : 'maj7') : 'maj'
    }
  })()
  return `${root}:${q}`
}

/** Harte label → lead-sheet text the chord parser reads (`C:min7` → `Cm7`). Null if not understood. */
export function fromHarte(label: string): string | null {
  const s = label.trim()
  if (s === 'N' || s === 'X' || s === '') return 'N.C.'
  const m = /^([A-G][b#]*)(?::([^/]*))?(?:\/(.+))?$/.exec(s)
  if (!m) return null
  const quality = HARTE_QUALITY[(m[2] ?? 'maj').replace(/\(.*\)$/, '')] ?? null
  if (quality === null) return null
  return m[1] + quality
}

const HARTE_QUALITY: Record<string, string> = {
  maj: '',
  min: 'm',
  aug: '+',
  dim: 'dim',
  '7': '7',
  maj7: 'maj7',
  min7: 'm7',
  minmaj7: 'mMaj7',
  dim7: 'dim7',
  hdim7: 'm7b5',
  maj6: '6',
  min6: 'm6',
  '9': '9',
  maj9: 'maj9',
  min9: 'm9',
  '11': '11',
  min11: 'm11',
  '13': '13',
  maj13: 'maj13',
  min13: 'm13',
  sus2: 'sus2',
  sus4: 'sus4',
  '5': '5',
  '1': '5',
}

export interface RawChord {
  startMs: number
  endMs: number
  /** Any text the chord parser reads (lead-sheet, Unicode, iReal), or a Harte label when `harte` is set */
  symbol: string
  confidence?: number
}

export interface FinishedAnalysis {
  chords: Timeline['chords']
  keys: Timeline['keys']
  /** Input symbols the parser did not understand (stored as N.C.) */
  unparsed: string[]
}

/**
 * Recogniser chords → canonical Timeline chords and key regions: parses, merges repeats, finds keys by
 * detectKeys over the chord sequence (weighted by beats), then respells every root in its key. With `sevenths`,
 * triads become the seventh chords a lead sheet would write in that key (`leadSheetSeventh`).
 */
export function finishAnalysis(
  raw: RawChord[],
  beatsMs: number[],
  opts: { harte?: boolean; sevenths?: boolean } = {},
): FinishedAnalysis {
  const unparsed: string[] = []
  type Item = { startMs: number; endMs: number; chord: ChordSymbol; confidence?: number }
  const items: Item[] = []
  for (const r of raw) {
    if (!(r.endMs > r.startMs)) continue
    const text = opts.harte ? fromHarte(r.symbol) : r.symbol
    let c = text === null ? null : parseChord(text)
    if (!c) {
      unparsed.push(r.symbol)
      c = NC
    }
    if (c.kind === 'chord') c = { ...c, root: neutral(pc(c.root)), bass: c.bass && neutral(pc(c.bass)) }
    const last = items[items.length - 1]
    if (last && formatChord(last.chord) === formatChord(c) && Math.abs(last.endMs - r.startMs) < 1) {
      const a = last.endMs - last.startMs
      const b = r.endMs - r.startMs
      if (last.confidence !== undefined && r.confidence !== undefined)
        last.confidence = (last.confidence * a + r.confidence * b) / (a + b)
      last.endMs = r.endMs
    } else {
      items.push({ startMs: r.startMs, endMs: r.endMs, chord: c, ...(r.confidence !== undefined ? { confidence: r.confidence } : {}) })
    }
  }
  const beatLen = medianStep(beatsMs) ?? 500
  const beatCount = (a: number, b: number): number => {
    let n = 0
    for (const t of beatsMs) if (t >= a - beatLen / 4 && t < b - beatLen / 4) n++
    return Math.max(n, (b - a) / beatLen)
  }
  // Keys from real chords only; N.C. stretches take the key around them.
  const real = items.map((it, i) => ({ it, i })).filter(({ it }) => it.chord.kind === 'chord')
  const { regions } = detectKeys(real.map(({ it }) => ({ chord: it.chord, beats: beatCount(it.startMs, it.endMs) })))
  const keyOfItem: Key[] = new Array(items.length)
  const keys: Timeline['keys'] = []
  for (const r of regions) {
    const from = r.start === 0 ? 0 : real[r.start]!.i
    const to = r.end === real.length ? items.length : real[r.end]!.i
    for (let i = from; i < to; i++) keyOfItem[i] = r.key
    const tonic = conventionalTonic(r.key)
    keys.push({ startMs: items[from]!.startMs, endMs: items[to - 1]!.endMs, tonic: noteName(tonic), mode: r.key.mode })
  }
  const chords: Timeline['chords'] = items.map((it, i) => {
    const k = keyOfItem[i]
    let c = it.chord
    if (k && opts.sevenths && c.kind === 'chord') c = leadSheetSeventh(c, k, items[i + 1]?.chord ?? null)
    c = k ? respellInKey(c, { ...k, tonic: conventionalTonic(k) }) : c
    return {
      startMs: round1(it.startMs),
      endMs: round1(it.endMs),
      symbol: formatChord(c),
      ...(it.confidence !== undefined ? { confidence: round3(it.confidence) } : {}),
    }
  })
  for (const k of keys) {
    k.startMs = round1(k.startMs)
    k.endMs = round1(k.endMs)
  }
  return { chords, keys, unparsed }
}

/**
 * The seventh chord a jazz lead sheet would write for a recogniser's triad, from its function in `key`.
 * Pop-trained recognisers drop 7ths that are rarely absent in jazz, and hear a 7♯9 as m7.
 *  - major triad: maj7 on I and IV (♭III and ♭VI in minor), dominant 7 elsewhere (V, secondary dominants, ♭VII)
 *  - minor triad: m7; but on v of a minor key resolving to i it is V7 (also when the recogniser said m7)
 *  - diminished triad: ø7 on ii of minor or vii of major, °7 elsewhere
 * Chords that already have a 7th, 6th, sus or altered 5th are left alone (except the v → V7 case).
 */
export function leadSheetSeventh(c: Chord, key: Key, next: ChordSymbol | null): Chord {
  const d = mod(pc(c.root) - pc(key.tonic), 12)
  const resolvesToTonic = next?.kind === 'chord' && mod(pc(next.root) - pc(key.tonic), 12) === 0
  const triad = c.seventh === 'none' && c.tensions.length === 0 && !c.alt
  if (c.third === 'min' && c.fifth === 'p' && key.mode === 'minor' && d === 7 && resolvesToTonic && (triad || c.seventh === 'min'))
    return { ...c, third: 'maj', seventh: 'min' }
  if (!triad) return c
  if (c.third === 'maj' && c.fifth === 'p') {
    const tonicLike = key.mode === 'major' ? d === 0 || d === 5 : d === 3 || d === 8
    return { ...c, seventh: tonicLike ? 'maj' : 'min' }
  }
  if (c.third === 'min' && c.fifth === 'p') return { ...c, seventh: 'min' }
  if (c.third === 'min' && c.fifth === 'b') {
    const half = (key.mode === 'minor' && d === 2) || (key.mode === 'major' && d === 11)
    return { ...c, seventh: half ? 'min' : 'dim' }
  }
  return c
}

/** Key names as players write them: D♭ not C♯ major, F♯ minor not G♭ minor, G♭/F♯ major → G♭. */
const MAJOR_TONIC = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6]
const MINOR_TONIC = [0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 6, 6]
function conventionalTonic(k: Key): Note {
  const p = pc(k.tonic)
  return spell((k.mode === 'major' ? MAJOR_TONIC : MINOR_TONIC)[p]!, p)
}

function medianStep(ts: number[]): number | null {
  if (ts.length < 2) return null
  const d = ts
    .slice(1)
    .map((t, i) => t - ts[i]!)
    .sort((a, b) => a - b)
  return d[d.length >> 1]!
}

const round1 = (x: number): number => Math.round(x * 10) / 10
const round3 = (x: number): number => Math.round(x * 1000) / 1000
