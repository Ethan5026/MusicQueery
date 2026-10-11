import type { Form } from './form'
import type { Rng } from './rng'
import type { BandStyle } from './styles'

export type Part = 'piano' | 'bass' | 'drums'
export const PARTS: Part[] = ['piano', 'bass', 'drums']

export type DrumPiece =
  | 'ride'
  | 'bell'
  | 'crash'
  | 'hhfoot'
  | 'hhclosed'
  | 'hhopen'
  | 'kick'
  | 'snare'
  | 'ghost'
  | 'xstick'
  | 'shaker'

/** A pitched note. `beat` counts from the start of the form (count-in beats are negative); `dur` in beats. */
export interface NoteEvent {
  part: 'piano' | 'bass'
  beat: number
  midi: number
  /** 0..1 */
  vel: number
  dur: number
}

export interface DrumEvent {
  part: 'drums'
  beat: number
  piece: DrumPiece
  vel: number
}

export type BandEvent = NoteEvent | DrumEvent

/** What a part needs to play one bar. */
export interface BarCtx {
  form: Form
  barIndex: number
  style: BandStyle
  bpm: number
  /** off-beat eighth position within the beat (0.5 straight, 2/3 triplet swing) */
  swing: number
  rng: Rng
}

/** Swung position of a straight-eighth grid point (x.5 → x + swing). */
export const swung = (x: number, swing: number): number => {
  const f = x - Math.floor(x)
  return Math.abs(f - 0.5) < 1e-9 ? Math.floor(x) + swing : x
}
