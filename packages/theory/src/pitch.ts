// Spelled pitch: a letter plus an accidental count, so E♭ and D♯ stay different.

export interface Note {
  /** 0..6 = C D E F G A B */
  letter: number
  /** −2..+2 in practice (♭♭ … ♯♯) */
  acc: number
}

/** Spelled interval: letter steps (0..6) and semitones (0..11), always upward. */
export interface Interval {
  steps: number
  semis: number
}

export const LETTERS = 'CDEFGAB'
export const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11] as const

export const mod = (n: number, m: number): number => ((n % m) + m) % m

const ACC_TOKENS: Array<[string, number]> = [
  ['𝄫', -2],
  ['𝄪', 2],
  ['♭♭', -2],
  ['♯♯', 2],
  ['bb', -2],
  ['##', 2],
  ['♭', -1],
  ['♯', 1],
  ['b', -1],
  ['#', 1],
]

/** Reads an accidental at the start of `s`; returns [acc, length]. ASCII doubles only when `asciiDoubles`. */
export function readAccidental(s: string, asciiDoubles = true): [number, number] {
  for (const [tok, a] of ACC_TOKENS) {
    if (!asciiDoubles && (tok === 'bb' || tok === '##')) continue
    if (s.startsWith(tok)) return [a, tok.length]
  }
  return [0, 0]
}

export function parseNote(s: string): Note | null {
  const letter = LETTERS.indexOf(s[0] ?? '')
  if (letter < 0) return null
  const [acc, len] = readAccidental(s.slice(1))
  if (1 + len !== s.length) return null
  return { letter, acc }
}

/** Throws on a bad name; for literals in code and tests. */
export function note(s: string): Note {
  const n = parseNote(s)
  if (!n) throw new Error(`bad note name: ${s}`)
  return n
}

export function accidentalText(acc: number, ascii = false): string {
  return acc > 0 ? (ascii ? '#' : '♯').repeat(acc) : (ascii ? 'b' : '♭').repeat(-acc)
}

export function noteName(n: Note, ascii = false): string {
  return (LETTERS[n.letter] ?? '?') + accidentalText(n.acc, ascii)
}

export const pc = (n: Note): number => mod((NATURAL_PC[n.letter] ?? 0) + n.acc, 12)

/** The note with letter `letter` (any integer, wrapped) sounding pitch class `pitch`. */
export function spell(letter: number, pitch: number): Note {
  const L = mod(letter, 7)
  let a = mod(pitch - (NATURAL_PC[L] ?? 0), 12)
  if (a > 6) a -= 12
  return { letter: L, acc: a }
}

export const transpose = (n: Note, iv: Interval): Note => spell(n.letter + iv.steps, pc(n) + iv.semis)

export const intervalBetween = (from: Note, to: Note): Interval => ({
  steps: mod(to.letter - from.letter, 7),
  semis: mod(pc(to) - pc(from), 12),
})

export const invert = (iv: Interval): Interval => ({ steps: mod(-iv.steps, 7), semis: mod(-iv.semis, 12) })

export const sameNote = (a: Note, b: Note): boolean => a.letter === b.letter && a.acc === b.acc

const FLAT_NAMES = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6] // letter for each pc, flat spelling
const SHARP_NAMES = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]

/** Respells double accidentals and E♯/B♯/F♭/C♭ to the plain name, keeping the sharp or flat side. */
export function simplify(n: Note): Note {
  const p = pc(n)
  const plain = spell(n.acc < 0 ? (FLAT_NAMES[p] ?? 0) : (SHARP_NAMES[p] ?? 0), p)
  return Math.abs(n.acc) >= 2 || Math.abs(plain.acc) < Math.abs(n.acc) ? plain : n
}

/** Spells a pitch class with flats or sharps. */
export const pcName = (p: number, flats = true): Note => spell((flats ? FLAT_NAMES : SHARP_NAMES)[mod(p, 12)] ?? 0, p)
