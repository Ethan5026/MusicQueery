// Pitch helpers shared by the parts: a chord's tones as pitch classes, and placing a pitch class near a MIDI note.
import { type Chord, chordNotes, chordTones, mod, pc } from '@mq/theory'

export interface ChordPcs {
  root: number
  /** slash bass, else the root */
  bass: number
  third: number | null
  fifth: number
  seventh: number | null
  /** 9/11/13 as written (or the 7alt set) */
  tensions: number[]
  dominant: boolean
  minor: boolean
}

export function chordPcs(c: Chord): ChordPcs {
  const tones = chordTones(c)
  const root = pc(c.root)
  const find = (slot: string) => tones.find((t) => t.slot === slot)
  const third = find('3')
  const seventh = find('7')
  return {
    root,
    bass: c.bass ? pc(c.bass) : root,
    third: third ? mod(root + third.semis, 12) : null,
    fifth: mod(root + (find('5')?.semis ?? 7), 12),
    seventh: seventh ? mod(root + seventh.semis, 12) : null,
    tensions: chordNotes(c)
      .slice(tones.length + (c.add3 ? 1 : 0))
      .map((n) => mod(root + n.semis, 12)),
    dominant: c.seventh === 'min' && (c.third === 'maj' || c.third === 'sus4' || c.add3),
    minor: c.third === 'min',
  }
}

/** The MIDI note of pitch class `p` closest to `near`, kept within [lo, hi] when possible. */
export function nearest(p: number, near: number, lo: number, hi: number): number {
  let best = near + mod(p - near, 12)
  if (best - near > 6) best -= 12
  while (best < lo) best += 12
  while (best > hi) best -= 12
  return best < lo ? best + 12 : best
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))
