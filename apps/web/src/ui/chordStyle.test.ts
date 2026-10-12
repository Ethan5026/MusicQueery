import { expect, test } from 'vitest'
import { styleQuality } from './chordStyle'

test('symbols: Δ for major sevenths, – for minor, ø for half-diminished; text leaves the quality alone', () => {
  const sym = (q: string) => styleQuality(q, 'symbols')
  expect(sym('maj7')).toBe('Δ7')
  expect(sym('maj9♯11')).toBe('Δ9♯11')
  expect(sym('m7')).toBe('–7')
  expect(sym('m')).toBe('–')
  expect(sym('m6')).toBe('–6')
  expect(sym('m7♭5')).toBe('ø7')
  expect(sym('mMaj7')).toBe('–Δ7')
  expect(sym('7♭9')).toBe('7♭9')
  expect(sym('°7')).toBe('°7')
  expect(sym('')).toBe('')
  expect(styleQuality('m7', 'text')).toBe('m7')
})
