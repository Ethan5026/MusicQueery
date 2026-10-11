import { describe, expect, test } from 'vitest'
import {
  DEMO_CHART,
  INSTRUMENT_IDS,
  THEORY_VERSION,
  chord,
  chordToConcert,
  chordToWritten,
  detectKeys,
  expandChart,
  findTwoFives,
  formatChord,
  guideTones,
  harmonicFunction,
  key,
  keyName,
  majorDegree,
  note,
  noteName,
  parseChord,
  pc,
  pickScale,
  romanNumeral,
  scaleNotes,
  simplify,
  toConcert,
  toWritten,
  transposeChart,
  type ChordSymbol,
  type Key,
  type Lens,
} from './index'

test('package loads', () => {
  expect(THEORY_VERSION).toBe(1)
})

// ---------------------------------------------------------------- pitch & instruments

test.each([
  ['A♭', 'alto', 'F'],
  ['A♭', 'tenor', 'B♭'],
  ['E♭', 'alto', 'C'],
  ['B♭', 'tenor', 'C'],
  ['C', 'alto', 'A'],
  ['F♯', 'alto', 'D♯'],
  ['D♭', 'tenor', 'E♭'],
] as const)('%s concert is %s on %s', (concert, inst, written) => {
  expect(noteName(toWritten(note(concert), inst))).toBe(written)
  expect(noteName(toConcert(note(written), inst))).toBe(concert)
})

test.each([
  ['B♭♭', 'A'], ['E♯', 'F'], ['C♭', 'B'], ['F𝄪', 'G'], ['G♯', 'G♯'], ['E♭', 'E♭'],
])('simplify %s → %s', (a, b) => {
  expect(noteName(simplify(note(a)))).toBe(b)
})

const TONICS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
const symbols = (c: typeof DEMO_CHART): string[] => c.bars.flatMap((b) => b.chords.map((s) => s.symbol))

describe('12 keys × 3 instruments round-trip', () => {
  test.each(TONICS.flatMap((t) => INSTRUMENT_IDS.map((i) => [t, i] as const)))('%s, %s', (tonic, inst) => {
    const moved = transposeChart(DEMO_CHART, tonic)
    expect(moved.key.tonic).toBe(tonic)
    for (const s of symbols(moved)) {
      const c = parseChord(s)!
      expect(formatChord(chordToConcert(chordToWritten(c, inst), inst))).toBe(s)
    }
    expect(symbols(transposeChart(moved, 'A♭'))).toEqual(symbols(DEMO_CHART))
  })
})

// ---------------------------------------------------------------- scales & lenses beyond the sketch

const pick = (sym: string, k: string, lens: Lens, next?: string, mode: Key['mode'] = 'major'): string => {
  const c = chord(sym)
  return pickScale(c, { degree: majorDegree(pc(c.root), key(k, mode)), next: next ? chord(next) : null }, lens)
}

test.each([
  // [chord, key, lens, next, scale]
  ['G7♭9', 'C', 'inside', 'Cmaj7', 'hwdim'],
  ['E7♭9', 'C', 'inside', 'Am7', 'phrygdom'],
  ['G7♭13', 'C', 'inside', 'Cmaj7', 'mixb6'],
  ['G7♯11', 'C', 'inside', 'Cmaj7', 'lyddom'],
  ['G7alt', 'C', 'inside', 'Cmaj7', 'altered'],
  ['G7♯9♭13', 'C', 'inside', 'Cmaj7', 'altered'],
  ['G13', 'C', 'colour', 'Am7', 'lyddom'],
  ['G7sus4', 'C', 'inside', 'Cmaj7', 'mixolydian'],
  ['G7♭9sus4', 'C', 'inside', 'Cmaj7', 'phrygian'],
  ['Cmaj7♯11', 'C', 'inside', '', 'lydian'],
  ['Cmaj7♯5', 'A', 'inside', '', 'lydaug'],
  ['Cm6', 'C', 'inside', '', 'dorian'],
  ['CmMaj7', 'C', 'inside', '', 'melmin'],
  ['CmMaj7', 'C', 'bebop', '', 'melmin'],
  ['Em9', 'C', 'inside', '', 'aeolian'],
  ['Bm9♭5', 'C', 'inside', '', 'locrian2'],
  ['G7♭9', 'C', 'bebop', 'Cmaj7', 'hwdim'],
  ['G7♭9', 'C', 'colour', 'Cmaj7', 'hwdim'],
  ['C+', 'C', 'inside', '', 'whole'],
  ['C6', 'C', 'colour', '', 'lydian'],
  ['Am7', 'A', 'inside', 'Dm7', 'aeolian'],
] as const)('%s in %s (%s, next %s) → %s', (sym, k, lens, next, want) => {
  const minor = sym === 'Am7' && k === 'A'
  expect(pick(sym, k, lens, next || undefined, minor ? 'minor' : 'major')).toBe(want)
})

test('scale spellings', () => {
  const n = (r: string, id: Parameters<typeof scaleNotes>[1]): string => scaleNotes(note(r), id).map((x) => noteName(x)).join(' ')
  expect(n('C', 'altered')).toBe('C D♭ D♯ E F♯ A♭ B♭')
  expect(n('G', 'hwdim')).toBe('G A♭ A♯ B C♯ D E F')
  expect(n('C', 'dim')).toBe('C D E♭ F G♭ A♭ A B')
  expect(n('F', 'bebopDom')).toBe('F G A B♭ C D E♭ E')
  expect(n('E♭', 'lydaug')).toBe('E♭ F G A B C D')
})

// ---------------------------------------------------------------- numerals & function

const fn = (seq: string[], i: number, k: Key): string => {
  const cs: ChordSymbol[] = seq.map((s) => parseChord(s)!)
  return harmonicFunction(cs[i - 1] ?? null, cs[i]!, cs[i + 1] ?? null, k, cs[i + 2] ?? null).text
}

test.each([
  [['Cmaj7', 'A7', 'Dm7', 'G7'], 1, 'C', 'V7/ii'],
  [['Cmaj7', 'E7', 'Am7'], 1, 'C', 'V7/vi'],
  [['Cmaj7', 'C7', 'Fmaj7'], 1, 'C', 'V7/IV'],
  [['Cmaj7', 'D7', 'G7'], 1, 'C', 'V7/V'],
  [['Cmaj7', 'D7', 'Dm7'], 1, 'C', 'V7/V'],
  [['Em7', 'A7', 'Dm7'], 0, 'C', 'ii7/ii'],
  [['Dm7', 'D♭7', 'Cmaj7'], 1, 'C', 'subV7'],
  [['Cmaj7', 'E♭7', 'Dm7'], 1, 'C', 'subV7/ii'],
  [['Cmaj7', 'Fm7', 'Cmaj7'], 1, 'C', 'iv7 borrowed'],
  [['Cmaj7', 'B♭7', 'Cmaj7'], 1, 'C', '♭VII7 borrowed'],
  [['Cmaj7', 'A♭maj7', 'Cmaj7'], 1, 'C', '♭VImaj7 borrowed'],
  [['Cmaj7', 'C♯°7', 'Dm7'], 1, 'C', 'passing °7'],
  [['Fmaj7', 'F♯°7', 'Gm7'], 1, 'F', 'passing °7'],
  [['Cmaj7', 'G♯°7', 'Am7'], 1, 'C', 'vii°7/vi'],
  [['F7', 'B♭7', 'F7'], 1, 'F', 'IV7'],
  [['Dm7♭5', 'G7', 'Cm6'], 0, 'C', 'iiø7'],
  [['Dm7♭5', 'G7', 'Cm6'], 1, 'C', 'V7'],
  [['Dm7♭5', 'G7', 'Cm6'], 2, 'C', 'i6'],
  [['Cm7', 'A♭maj7'], 1, 'C', '♭VImaj7'],
  [['Cm7', 'B°7', 'Cm7'], 1, 'C', 'vii°7'],
  [['N.C.'], 0, 'C', 'N.C.'],
] as const)('%j[%i] in %s → %s', (seq, i, k, want) => {
  const minor = seq[0] === 'Dm7♭5' || seq[0] === 'Cm7'
  expect(fn([...seq], i, key(k, minor ? 'minor' : 'major'))).toBe(want)
})

test.each([
  ['C+', 'C', 'I+'], ['Csus4', 'C', 'Isus'], ['G7sus4', 'C', 'V7sus'], ['B♭6', 'F', 'IV6'], ['Dm6', 'C', 'ii6'],
  ['F♯m7♭5', 'C', '♯ivø7'], ['C7alt', 'F', 'V7'],
])('numeral of %s in %s is %s', (sym, k, want) => {
  expect(romanNumeral(chord(sym), key(k))).toBe(want)
})

// ---------------------------------------------------------------- key regions on other forms

const regions = (bars: string[][], home?: Key): string[] => {
  const items = bars.flatMap((b) => b.map((s) => ({ chord: parseChord(s)!, beats: 4 / b.length })))
  return detectKeys(items, home ? { home } : {}).regions.map((r) => keyName(r.key))
}

test('jazz blues in F stays in F', () => {
  const blues = [['F7'], ['B♭7'], ['F7'], ['Cm7', 'F7'], ['B♭7'], ['B°7'], ['F7'], ['D7'], ['Gm7'], ['C7'], ['F7', 'D7'], ['Gm7', 'C7']]
  expect(regions(blues, key('F'))).toEqual(['F major'])
})

test('rhythm changes bridge stays in B♭ (secondary dominants)', () => {
  const a = [['B♭maj7', 'G7'], ['Cm7', 'F7'], ['Dm7', 'G7'], ['Cm7', 'F7']]
  const bridge = [['D7'], ['D7'], ['G7'], ['G7'], ['C7'], ['C7'], ['F7'], ['F7']]
  expect(regions([...a, ...bridge, ...a], key('B♭'))).toEqual(['B♭ major'])
})

test('Autumn Leaves reads as one G minor region', () => {
  const al = [['Cm7'], ['F7'], ['B♭maj7'], ['E♭maj7'], ['Am7♭5'], ['D7'], ['Gm6'], ['Gm6']]
  expect(regions(al, key('G', 'minor'))).toEqual(['G minor'])
  const seq = al.flat()
  expect(seq.map((_, i) => fn(seq, i, key('G', 'minor')))).toEqual(
    ['ii7/♭III', '♭VII7', '♭IIImaj7', '♭VImaj7', 'iiø7', 'V7', 'i6', 'i6'],
  )
})

test('Coltrane changes find three key centres', () => {
  const gs = [['Bmaj7', 'D7'], ['Gmaj7', 'B♭7'], ['E♭maj7'], ['Am7', 'D7'], ['Gmaj7', 'B♭7'], ['E♭maj7', 'F♯7'], ['Bmaj7'], ['Fm7', 'B♭7']]
  const r = regions(gs)
  expect(new Set(r)).toEqual(new Set(['B major', 'G major', 'E♭ major']))
})

// ---------------------------------------------------------------- guide tones & ii–V–I

test('guide tones: 7th falls to the 3rd, 3rd holds as the 7th', () => {
  const g = guideTones(chord('Dm7'), chord('G7'))!
  expect(g.map((m) => `${noteName(m.from)}${m.fromSlot}>${noteName(m.to)}${m.toSlot}`)).toEqual(['F3>F7', 'C7>B3'])
  expect(g[1]!.semis).toBe(-1)
  expect(guideTones(chord('C'), chord('G7'))).toBeNull()
  expect(guideTones(chord('C6'), chord('Dm7'))!.map((m) => m.toSlot)).toEqual(['3', '7'])
})

test('ii–V–I detection: major, minor, tritone sub, unresolved', () => {
  const seq = ['Dm7', 'G7', 'Cmaj7', 'Dm7♭5', 'G7♭9', 'Cm6', 'Em7', 'E♭7', 'Dmaj7', 'Am7', 'D7', 'B♭maj7'].map((s) => parseChord(s)!)
  const t = findTwoFives(seq)
  expect(t.map((x) => [x.start, x.length, x.mode, noteName(x.target), x.sub])).toEqual([
    [0, 3, 'major', 'C', false],
    [3, 3, 'minor', 'C', false],
    [6, 3, 'major', 'D', true],
    [9, 2, 'major', 'G', false],
  ])
  expect(t[0]!.line.map((n) => noteName(n))).toEqual(['C', 'B', 'B'])
})

test('demo chart expands to intro + 5 choruses + ending', () => {
  const played = expandChart(DEMO_CHART)
  expect(played).toHaveLength(4 + 5 * 36 + 4)
  expect(played.filter((p) => p.chartBar === 4).map((p) => p.pass)).toEqual([1, 2, 3, 4, 5])
})
