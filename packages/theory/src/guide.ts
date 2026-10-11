// Guide-tone motion (3rd and 7th into the next chord) and ii–V–I spans.
import { type Chord, type ChordSymbol, type ChordTone, chordTones, family } from './chord'
import { type Note, mod, pc } from './pitch'

export interface GuideMove {
  from: Note
  fromSlot: '3' | '7'
  to: Note
  toSlot: '3' | '7'
  /** signed semitones, smallest motion (−6..+6) */
  semis: number
}

const slot = (ts: ChordTone[], s: ChordTone['slot']): Note | undefined => ts.find((t) => t.slot === s)?.note

const motion = (a: Note, b: Note): number => {
  const up = mod(pc(b) - pc(a), 12)
  return up > 6 ? up - 12 : up
}

/**
 * The 3rd and 7th of `a`, each moving to the nearer of `b`'s 3rd and 7th (the sketch's guideHTML; ties go to the 3rd).
 * Null when `a` has no 7th (or 6th) or `b` has no 3rd.
 */
export function guideTones(a: Chord, b: Chord): GuideMove[] | null {
  const at = chordTones(a)
  const bt = chordTones(b)
  const a3 = slot(at, '3')
  const a7 = slot(at, '7')
  const b3 = slot(bt, '3')
  const b7 = slot(bt, '7')
  if (!a3 || !a7 || !b3) return null
  const cand: Array<[Note, '3' | '7']> = [
    [b3, '3'],
    [b7 ?? b3, b7 ? '7' : '3'],
  ]
  const pair = (n: Note, fromSlot: '3' | '7'): GuideMove => {
    let best = cand[0]!
    let bd = 99
    for (const c of cand) {
      const d = Math.abs(motion(n, c[0]))
      if (d < bd) {
        bd = d
        best = c
      }
    }
    return { from: n, fromSlot, to: best[0], toSlot: best[1], semis: motion(n, best[0]) }
  }
  return [pair(a3, '3'), pair(a7, '7')]
}

export interface TwoFive {
  /** index of the ii */
  start: number
  /** 2 (ii–V) or 3 (ii–V–I) */
  length: 2 | 3
  mode: 'major' | 'minor'
  /** root of the I (or of the expected I when unresolved) */
  target: Note
  /** V is a tritone substitute (♭II7) */
  sub: boolean
  /** guide-tone line: 7th of ii → 3rd of V → 7th (or 3rd) of I */
  line: Note[]
}

const isII = (c: Chord): boolean => family(c) === 'min' || family(c) === 'half'
const isI = (c: Chord): boolean => family(c) === 'maj' || family(c) === 'min'

/** Finds ii–V–I (and unresolved ii–V) spans. Tritone-sub Vs (ii–♭II7–I) count. */
export function findTwoFives(chords: ChordSymbol[]): TwoFive[] {
  const out: TwoFive[] = []
  for (let j = 0; j + 1 < chords.length; j++) {
    const a = chords[j]!
    const b = chords[j + 1]!
    if (a.kind !== 'chord' || b.kind !== 'chord' || !isII(a) || family(b) !== 'dom') continue
    const ra = pc(a.root)
    const rb = pc(b.root)
    const plain = mod(rb - ra, 12) === 5
    const sub = mod(rb - ra, 12) === 11
    if (!plain && !sub) continue
    const c = chords[j + 2]
    const targetPc = mod(ra - 2, 12)
    const resolved = c?.kind === 'chord' && isI(c) && pc(c.root) === targetPc
    const at = chordTones(a)
    const bt = chordTones(b)
    const line = [slot(at, '7'), slot(bt, '3')].filter((n): n is Note => !!n)
    let mode: 'major' | 'minor' = family(a) === 'half' ? 'minor' : 'major'
    let target: Note = { letter: mod(a.root.letter - 1, 7), acc: 0 }
    target = { letter: target.letter, acc: mod(targetPc - pc(target) + 6, 12) - 6 }
    if (resolved) {
      const cc = c as Chord
      mode = family(cc) === 'min' ? 'minor' : 'major'
      target = cc.root
      const ct = chordTones(cc)
      const n = slot(ct, '7') ?? slot(ct, '3')
      if (n) line.push(n)
    }
    out.push({ start: j, length: resolved ? 3 : 2, mode, target, sub, line })
    if (resolved) j += 1
  }
  return out
}
