// M12: jazz-ready lead sheets from recordings — scales for plain triads from the key, ii–Vs on heard triads,
// chord detail (triads / as heard / lead-sheet 7ths), tensions in the moment, and spellings a player expects.
import type { Timeline } from '@mq/model'
import { expect, test } from 'vitest'
import { conventionalTonic, finishAnalysis, respellInKey } from './analysed'
import { chord, formatChord, parseChord } from './chord'
import { findTwoFives } from './guide'
import { withChordDetail, moment } from './moment'
import { key, majorDegree } from './numeral'
import { noteName, pc } from './pitch'
import { songKey } from './ireal'
import { keyMode, pickScale } from './scales'

const mode = (sym: string, k: string, m: 'major' | 'minor' = 'major') => {
  const c = chord(sym)
  return keyMode(c, majorDegree(pc(c.root), key(k, m)))
}

test('a plain triad takes the key’s own mode', () => {
  expect(mode('C', 'C')).toBe('major')
  expect(mode('G', 'C')).toBe('mixolydian')
  expect(mode('F', 'C')).toBe('lydian')
  expect(mode('Dm', 'C')).toBe('dorian')
  expect(mode('Em', 'C')).toBe('phrygian')
  expect(mode('B♭', 'C')).toBe('lydian') // ♭VII: the key with B♭ swapped in
  expect(mode('D', 'C')).toBe('mixolydian') // II (V/V): F♯ swapped in
  expect(mode('E', 'A', 'minor')).toBe('phrygdom')
  expect(mode('D', 'A', 'minor')).toBe('mixolydian') // Dorian IV
  expect(mode('A', 'C')).toBe('mixb6') // V/ii
})

test('pickScale uses it for triads under Inside and Bebop, not for 7th chords or Colour', () => {
  const p = (sym: string, k: string, lens: 'inside' | 'bebop' | 'colour') => {
    const c = chord(sym)
    return pickScale(c, { degree: majorDegree(pc(c.root), key(k)), next: null }, lens)
  }
  expect(p('G', 'C', 'inside')).toBe('mixolydian')
  expect(p('G', 'C', 'bebop')).toBe('bebopDom')
  expect(p('G', 'C', 'colour')).not.toBe('mixolydian')
  expect(p('Gmaj7', 'C', 'inside')).toBe('major') // a written maj7 on V is taken at its word
})

test('a V heard as a plain triad is a ii–V only when it resolves', () => {
  const seq = (...s: string[]) => s.map((x) => parseChord(x)!)
  expect(findTwoFives(seq('Dm', 'G', 'C'))).toHaveLength(1)
  expect(findTwoFives(seq('Dm', 'G', 'C'))[0]!.length).toBe(3)
  expect(findTwoFives(seq('Dm', 'G', 'Am'))).toHaveLength(0)
  expect(findTwoFives(seq('Dm7', 'G7', 'Am'))).toHaveLength(1) // a written V7 still counts unresolved
  expect(findTwoFives(seq('Dm', 'D♭', 'C'))).toHaveLength(0) // a tritone sub needs its 7th
})

const tl = (chords: string[], keys: Timeline['keys']): Timeline => ({
  schema: 'mq.timeline/1',
  id: 'spotify:track:0000000000000000000000',
  source: 'analysed',
  durationMs: chords.length * 2000,
  createdAt: '2026-11-01T00:00:00.000Z',
  generator: 'test',
  meter: { num: 4, den: 4 },
  beats: Array.from({ length: chords.length * 4 }, (_, i) => i * 500),
  bars: Array.from({ length: chords.length }, (_, i) => ({ startMs: i * 2000, number: i + 1 })),
  chords: chords.map((symbol, i) => ({ startMs: i * 2000, endMs: (i + 1) * 2000, symbol })),
  keys,
  tempo: [{ startMs: 0, bpm: 120 }],
  edits: [],
})

test('chord detail: lead-sheet 7ths, triads, or as heard', () => {
  const t = tl(['Am', 'Dm', 'G', 'C', 'F', 'Bdim', 'E', 'Am'], [{ startMs: 0, endMs: 16000, tonic: 'A', mode: 'minor' }])
  const syms = (x: Timeline) => x.chords.map((c) => c.symbol).join(' ')
  expect(withChordDetail(t, 'heard')).toBe(t)
  expect(syms(withChordDetail(t, 'lead'))).toBe('Am7 Dm7 G7 Cmaj7 Fmaj7 Bm7♭5 E7 Am7')
  const rich = tl(['Cmaj9', 'A7♭9', 'Dm11', 'G13'], [{ startMs: 0, endMs: 8000, tonic: 'C', mode: 'major' }])
  expect(syms(withChordDetail(rich, 'triads'))).toBe('C A Dm G')
  // the player's own fixes win over the detail
  const fixed = { ...t, edits: [{ startMs: 4000, endMs: 6000, symbol: 'G7sus4', at: '2026-11-01T00:00:00.000Z' }] }
  expect(syms(withChordDetail(fixed, 'lead'))).toContain('G7sus4')
})

test('the moment lists the chord’s tensions in written pitch', () => {
  const t = tl(['E9', 'E9'], [{ startMs: 0, endMs: 4000, tonic: 'E', mode: 'major' }])
  expect(moment(t, 100, { instrument: 'concert', lens: 'inside' }).tensions).toEqual(['F♯'])
  expect(moment(t, 100, { instrument: 'alto', lens: 'inside' }).tensions).toEqual(['D♯'])
})

test('C♭7 is written B7 unless C♭ belongs to the key', () => {
  expect(formatChord(respellInKey(chord('B7'), key('E♭', 'minor')))).toBe('B7')
  expect(formatChord(respellInKey(chord('Bmaj7'), key('G♭')))).toBe('C♭maj7')
  expect(formatChord(respellInKey(chord('E'), key('D♭')))).toBe('E')
})

test('six-accidental keys follow the song’s side of the circle', () => {
  expect(noteName(conventionalTonic(key('G♭')))).toBe('G♭')
  expect(noteName(conventionalTonic(key('G♭'), 1))).toBe('F♯')
  expect(noteName(conventionalTonic(key('E♭', 'minor'), 1))).toBe('D♯')
  expect(noteName(conventionalTonic(key('D♭')))).toBe('D♭')
  // As (B major) with an F♯ stretch: F♯ major, not G♭ major
  const syms = [
    ...['B', 'E', 'F#', 'B', 'G#m', 'C#m', 'F#', 'B', 'B', 'E', 'F#', 'B', 'G#m', 'C#m', 'F#', 'B'],
    ...['F#', 'C#', 'D#m', 'C#', 'F#', 'G#m', 'C#', 'F#'],
  ]
  const raw = syms.map((symbol, i) => ({ startMs: i * 2000, endMs: (i + 1) * 2000, symbol }))
  const fin = finishAnalysis(raw, Array.from({ length: syms.length * 4 }, (_, i) => i * 500))
  const names = fin.keys.map((k) => `${k.tonic} ${k.mode}`)
  expect(names[0]).toBe('B major')
  expect(names).not.toContain('G♭ major')
})

test('songKey matches Spotify titles to chart titles', () => {
  expect(songKey('Let It Be - Remastered 2009')).toBe(songKey('Let It Be'))
  expect(songKey('Fly Me To The Moon (In Other Words)')).toBe(songKey('Fly Me To The Moon'))
  expect(songKey('The Girl From Ipanema')).toBe(songKey('Girl From Ipanema, The'))
  expect(songKey('What Is Hip?')).toBe('what is hip')
  expect(songKey('Lover (Live)')).toBe('lover')
})
