import { describe, expect, test } from 'vitest'
import { canonical, chord, chordNotes, chordTones, family, formatChord, parseChord, transposeChord } from './chord'
import { noteName } from './pitch'

// input → canonical
const CASES: Array<[string, string]> = [
  // sketch vocabulary is already canonical
  ['Fm7', 'Fm7'], ['B♭m7', 'B♭m7'], ['A♭maj7', 'A♭maj7'], ['C7♯5', 'C7♯5'], ['B°7', 'B°7'], ['Gm7♭5', 'Gm7♭5'], ['C', 'C'],
  // triads
  ['Cm', 'Cm'], ['Cmin', 'Cm'], ['C-', 'Cm'], ['Cdim', 'C°'], ['Co', 'C°'], ['C+', 'C+'], ['Caug', 'C+'], ['C5', 'C5'],
  ['CM', 'C'], ['Csus', 'Csus4'], ['Csus4', 'Csus4'], ['Csus2', 'Csus2'], ['C2', 'Cadd9'], ['Cadd9', 'Cadd9'], ['Cmadd9', 'Cmadd9'],
  // sixths
  ['C6', 'C6'], ['C69', 'C6/9'], ['C6/9', 'C6/9'], ['Cm6', 'Cm6'], ['C-69', 'Cm6/9'], ['C-6', 'Cm6'],
  // sevenths and extensions
  ['Cmaj7', 'Cmaj7'], ['CM7', 'Cmaj7'], ['CΔ7', 'Cmaj7'], ['C^7', 'Cmaj7'], ['C^', 'Cmaj7'], ['Cma7', 'Cmaj7'],
  ['Cmaj9', 'Cmaj9'], ['C^9', 'Cmaj9'], ['C^13', 'Cmaj13'], ['Cmaj7#11', 'Cmaj7♯11'], ['C^9#11', 'Cmaj9♯11'], ['C^7#5', 'Cmaj7♯5'],
  ['Cm7', 'Cm7'], ['C-7', 'Cm7'], ['Cmi7', 'Cm7'], ['Cm9', 'Cm9'], ['C-11', 'Cm11'], ['Cm13', 'Cm13'],
  ['CmMaj7', 'CmMaj7'], ['Cm(maj7)', 'CmMaj7'], ['C-^7', 'CmMaj7'], ['C-^9', 'CmMaj9'], ['Cmmaj7', 'CmMaj7'],
  ['C7', 'C7'], ['C9', 'C9'], ['C11', 'C11'], ['C13', 'C13'],
  ['Cø', 'Cm7♭5'], ['Cø7', 'Cm7♭5'], ['Ch', 'Cm7♭5'], ['Ch7', 'Cm7♭5'], ['Ch9', 'Cm9♭5'], ['C-7b5', 'Cm7♭5'],
  ['Cdim7', 'C°7'], ['Co7', 'C°7'], ['Co^7', 'C°maj7'],
  // alterations
  ['C7b9', 'C7♭9'], ['C7#9', 'C7♯9'], ['C7#11', 'C7♯11'], ['C7b5', 'C7♭5'], ['C7#5', 'C7♯5'], ['C7+', 'C7♯5'], ['C+7', 'C7♯5'],
  ['C7b13', 'C7♭13'], ['C7b9b13', 'C7♭9♭13'], ['C7#9#5', 'C7♯5♯9'], ['C7#9b5', 'C7♭5♯9'], ['C7b9#9', 'C7♭9♯9'],
  ['C7b9#11', 'C7♭9♯11'], ['C7#9#11', 'C7♯9♯11'], ['C7b9b5', 'C7♭5♭9'], ['C7b9#5', 'C7♯5♭9'],
  ['C9#11', 'C9♯11'], ['C9b5', 'C9♭5'], ['C9#5', 'C9♯5'], ['C13#11', 'C13♯11'], ['C13b9', 'C13♭9'], ['C13#9', 'C13♯9'],
  ['C7alt', 'C7alt'], ['Calt', 'C7alt'], ['C7(b9,#11)', 'C7♭9♯11'], ['C7(13)', 'C7add13'], ['Cm7(11)', 'Cm7add11'],
  ['C-#5', 'Cm♯5'], ['C-b6', 'Cm♭6'], ['C7♭9', 'C7♭9'],
  // sus
  ['C7sus', 'C7sus4'], ['C7sus4', 'C7sus4'], ['C9sus', 'C9sus4'], ['C13sus', 'C13sus4'], ['C7b9sus', 'C7♭9sus4'],
  ['C7b13sus', 'C7♭13sus4'], ['C7susadd3', 'C7sus4add3'],
  // roots, slash chords, N.C.
  ['Bb7', 'B♭7'], ['F#m7', 'F♯m7'], ['Ebmaj7', 'E♭maj7'], ['C/E', 'C/E'], ['F7/Eb', 'F7/E♭'], ['Am7/G', 'Am7/G'],
  ['D/F#', 'D/F♯'], ['C6/9/E', 'C6/9/E'], ['C/C', 'C'], ['N.C.', 'N.C.'], ['NC', 'N.C.'], ['n', 'N.C.'],
]

describe('canonical form', () => {
  test.each(CASES)('%s → %s', (input, want) => {
    expect(canonical(input)).toBe(want)
  })
  test.each(CASES)('%s: canonical form parses back to the same chord', (input) => {
    const c = parseChord(input)!
    expect(parseChord(formatChord(c))).toEqual(c)
    expect(canonical(formatChord(c))).toBe(formatChord(c))
  })
})

test.each(['', 'H7', 'Cx', 'C7q', 'Cmajmaj7', 'C77', 'Cm7b5b5', 'Cdim7#5'])('rejects %j', (s) => {
  expect(parseChord(s)).toBeNull()
})

test('ASCII formatting', () => {
  expect(formatChord(chord('B♭m7♭5'), true)).toBe('Bbm7b5')
  expect(formatChord(chord('F♯°7'), true)).toBe('F#dim7')
})

const tones = (s: string): string[] => chordTones(chord(s)).map((t) => noteName(t.note))
const notes = (s: string): string[] => chordNotes(chord(s)).map((t) => noteName(t.note))

test.each([
  ['Cmaj7', ['C', 'E', 'G', 'B']],
  ['Dm7', ['D', 'F', 'A', 'C']],
  ['G7', ['G', 'B', 'D', 'F']],
  ['Bm7♭5', ['B', 'D', 'F', 'A']],
  ['B°7', ['B', 'D', 'F', 'A♭']],
  ['C7♯5', ['C', 'E', 'G♯', 'B♭']],
  ['E♭6', ['E♭', 'G', 'B♭', 'C']],
  ['F♯m', ['F♯', 'A', 'C♯']],
  ['G7sus4', ['G', 'C', 'D', 'F']],
  ['C5', ['C', 'G']],
  ['A♭mMaj7', ['A♭', 'C♭', 'E♭', 'G']],
])('tones of %s', (s, want) => {
  expect(tones(s)).toEqual(want)
})

test.each([
  ['C13', ['C', 'E', 'G', 'B♭', 'D', 'A']],
  ['C7♭9♯11', ['C', 'E', 'G', 'B♭', 'D♭', 'F♯']],
  ['C7alt', ['C', 'E', 'G', 'B♭', 'D♭', 'D♯', 'F♯', 'A♭']],
  ['Cm11', ['C', 'E♭', 'G', 'B♭', 'D', 'F']],
  ['C6/9', ['C', 'E', 'G', 'A', 'D']],
  ['C7sus4add3', ['C', 'E', 'F', 'G', 'B♭']],
])('all notes of %s', (s, want) => {
  expect(notes(s)).toEqual(want)
})

test.each([
  ['Cmaj7', 'maj'], ['C6', 'maj'], ['C', 'maj'], ['Cm7', 'min'], ['CmMaj7', 'min'], ['C7', 'dom'], ['C7sus4', 'dom'],
  ['C7alt', 'dom'], ['C7♯5', 'dom'], ['Cm7♭5', 'half'], ['C°7', 'dim'], ['C°', 'dim'], ['C+', 'aug'], ['Csus4', 'sus'],
  ['C5', 'power'], ['Cmaj7♯5', 'maj'],
])('family of %s is %s', (s, f) => {
  expect(family(chord(s))).toBe(f)
})

test('transposing keeps the spelling exact', () => {
  const c = chord('F♯m7♭5/C')
  expect(formatChord(transposeChord(c, { steps: 2, semis: 3 }))).toBe('Am7♭5/E♭')
})
