import { Timeline } from '@mq/model'
import { expect, test } from 'vitest'
import { finishAnalysis, fromHarte, leadSheetSeventh, respellInKey, spellInKey, toHarte } from './analysed'
import { chord, formatChord, parseChord } from './chord'
import { key } from './numeral'
import { noteName } from './pitch'

const names = (k: ReturnType<typeof key>) => Array.from({ length: 12 }, (_, p) => noteName(spellInKey(p, k))).join(' ')

test('spellInKey names pitch classes as degrees of the key', () => {
  expect(names(key('C'))).toBe('C D♭ D E♭ E F F♯ G A♭ A B♭ B')
  expect(names(key('A♭'))).toBe('C D♭ D E♭ E F G♭ G A♭ A B♭ B')
  expect(names(key('E'))).toBe('C C♯ D D♯ E F F♯ G G♯ A A♯ B')
  expect(names(key('A', 'minor'))).toBe('C C♯ D D♯ E F F♯ G G♯ A B♭ B')
  // scale notes keep their degree name even when it is C♭; chromatic white keys stay natural
  expect(noteName(spellInKey(11, key('G♭')))).toBe('C♭')
  expect(noteName(spellInKey(5, key('G♭')))).toBe('F')
})

test('respellInKey keeps the quality and fixes root and bass', () => {
  expect(formatChord(respellInKey(chord('C#m7'), key('E')))).toBe('C♯m7')
  expect(formatChord(respellInKey(chord('C#m7'), key('A♭')))).toBe('D♭m7')
  expect(formatChord(respellInKey(chord('D7/F#'), key('G')))).toBe('D7/F♯')
  expect(formatChord(respellInKey(chord('A#7'), key('E♭')))).toBe('B♭7')
})

test('toHarte reduces to the seventh chord', () => {
  const h = (s: string) => toHarte(parseChord(s)!)
  expect(h('Cmaj7')).toBe('C:maj7')
  expect(h('C△9')).toBe('C:maj7')
  expect(h('Dm9')).toBe('D:min7')
  expect(h('G13♭9')).toBe('G:7')
  expect(h('G7alt')).toBe('G:7')
  expect(h('B♭7♯5')).toBe('Bb:aug(b7)')
  expect(h('F♯m7♭5')).toBe('F#:hdim7')
  expect(h('C°7')).toBe('C:dim7')
  expect(h('E♭6')).toBe('Eb:maj6')
  expect(h('Cm6')).toBe('C:min6')
  expect(h('CmMaj7')).toBe('C:minmaj7')
  expect(h('G7sus4')).toBe('G:sus4(b7)')
  expect(h('F/A')).toBe('F:maj')
  expect(h('N.C.')).toBe('N')
})

test('fromHarte reads recogniser labels', () => {
  expect(fromHarte('C#:min7')).toBe('C#m7')
  expect(fromHarte('Bb:hdim7')).toBe('Bbm7b5')
  expect(fromHarte('A')).toBe('A')
  expect(fromHarte('G:7(b9)')).toBe('G7')
  expect(fromHarte('E:maj/3')).toBe('E')
  expect(fromHarte('N')).toBe('N.C.')
  expect(fromHarte('C:weird')).toBeNull()
  for (const q of ['maj', 'min', '7', 'maj7', 'min7', 'hdim7', 'dim7', 'maj6', 'min6', 'minmaj7', 'aug', 'sus4', 'sus2']) {
    const text = fromHarte(`D:${q}`)!
    expect(parseChord(text), q).not.toBeNull()
    expect(toHarte(parseChord(text)!), q).toBe(`D:${q}`)
  }
})

test('finishAnalysis: merges, finds the key, spells roots in it', () => {
  const beat = 500
  const beats = Array.from({ length: 64 }, (_, i) => i * beat)
  // ii–V–I in D♭ written with sharps by the recogniser, then the same in E.
  const seq = ['D#:min7', 'D#:min7', 'G#:7', 'C#:maj7', 'C#:maj7', 'F#:min7', 'B:7', 'E:maj7', 'E:maj7', 'N']
  const raw = seq.map((s, i) => ({ startMs: i * 4 * beat, endMs: (i + 1) * 4 * beat, symbol: s, confidence: 0.5 }))
  const out = finishAnalysis(raw, beats, { harte: true })
  expect(out.unparsed).toEqual([])
  expect(out.chords.map((c) => c.symbol)).toEqual(['E♭m7', 'A♭7', 'D♭maj7', 'F♯m7', 'B7', 'Emaj7', 'N.C.'])
  expect(out.chords[0]).toMatchObject({ startMs: 0, endMs: 4000, confidence: 0.5 })
  expect(out.keys.map((k) => `${k.tonic} ${k.mode}`)).toEqual(['D♭ major', 'E major'])
  expect(out.keys[0]!.startMs).toBe(0)
  expect(out.keys[1]!.endMs).toBe(20000)
  const tl = {
    schema: 'mq.timeline/1',
    id: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
    source: 'analysed',
    durationMs: 20000,
    createdAt: new Date().toISOString(),
    meter: { num: 4, den: 4 },
    beats,
    bars: [],
    tempo: [{ startMs: 0, bpm: 120 }],
    ...out,
  }
  expect(Timeline.safeParse(tl).success).toBe(true)
})

test('finishAnalysis lists symbols it cannot read and stores them as N.C.', () => {
  const out = finishAnalysis([{ startMs: 0, endMs: 1000, symbol: 'Q:xyz' }], [0, 500], { harte: true })
  expect(out.unparsed).toEqual(['Q:xyz'])
  expect(out.chords[0]!.symbol).toBe('N.C.')
  expect(out.keys).toEqual([])
})

test('leadSheetSeventh writes the sevenths a jazz chart would', () => {
  const ls = (sym: string, k: ReturnType<typeof key>, next: string | null = null) =>
    formatChord(leadSheetSeventh(chord(sym), k, next ? chord(next) : null))
  const C = key('C')
  const Fm = key('F', 'minor')
  expect(ls('C', C)).toBe('Cmaj7')
  expect(ls('F', C)).toBe('Fmaj7')
  expect(ls('G', C)).toBe('G7')
  expect(ls('D', C)).toBe('D7') // V/V
  expect(ls('Dm', C)).toBe('Dm7')
  expect(ls('Bdim', C)).toBe('Bm7♭5')
  expect(ls('C#dim', C)).toBe('C♯°7')
  expect(ls('Fm', Fm)).toBe('Fm7')
  expect(ls('Ab', Fm)).toBe('A♭maj7')
  expect(ls('Bb', Fm)).toBe('B♭7')
  expect(ls('Gdim', Fm)).toBe('Gm7♭5')
  expect(ls('Cm', Fm, 'Fm')).toBe('C7')
  expect(ls('Cm7', Fm, 'Fm7')).toBe('C7')
  expect(ls('Cm', Fm, 'D♭')).toBe('Cm7')
  // already explicit: untouched
  expect(ls('C6', C)).toBe('C6')
  expect(ls('G7♯9', C)).toBe('G7♯9')
  expect(ls('Csus4', C)).toBe('Csus4')
})

test('finishAnalysis with sevenths', () => {
  const beats = Array.from({ length: 32 }, (_, i) => i * 500)
  const seq = ['D:min', 'G:maj', 'C:maj', 'A:min']
  const raw = seq.map((s, i) => ({ startMs: i * 2000, endMs: (i + 1) * 2000, symbol: s }))
  expect(finishAnalysis(raw, beats, { harte: true, sevenths: true }).chords.map((c) => c.symbol)).toEqual([
    'Dm7',
    'G7',
    'Cmaj7',
    'Am7',
  ])
})
