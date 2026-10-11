// Instrument views (D-05, D-08): written pitch for E♭ alto (M6 up) and B♭ tenor (M9 up, shown as pitch class).
import { type ChordSymbol, transposeChord } from './chord'
import { type Interval, type Note, invert, transpose } from './pitch'

export type InstrumentId = 'concert' | 'alto' | 'tenor'

export const INSTRUMENTS: Record<InstrumentId, { interval: Interval; label: string; short: string }> = {
  concert: { interval: { steps: 0, semis: 0 }, label: 'Concert pitch', short: 'C' },
  alto: { interval: { steps: 5, semis: 9 }, label: 'Written · E♭ alto', short: 'E♭' },
  tenor: { interval: { steps: 1, semis: 2 }, label: 'Written · B♭ tenor', short: 'B♭' },
}

export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS) as InstrumentId[]

export const toWritten = (n: Note, inst: InstrumentId): Note => transpose(n, INSTRUMENTS[inst].interval)
export const toConcert = (n: Note, inst: InstrumentId): Note => transpose(n, invert(INSTRUMENTS[inst].interval))

export const chordToWritten = <T extends ChordSymbol>(c: T, inst: InstrumentId): T =>
  transposeChord(c, INSTRUMENTS[inst].interval)
export const chordToConcert = <T extends ChordSymbol>(c: T, inst: InstrumentId): T =>
  transposeChord(c, invert(INSTRUMENTS[inst].interval))
