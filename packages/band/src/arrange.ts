// The arranger: one bar of piano, bass and drums at a time, for the audio scheduler to ask for just ahead of the
// playhead. Choices are seeded by (seed, bar), so a bar sounds the same after a seek; voice leading carries over
// from the bar before only when bars are asked for in order.
import { bassBar } from './bass'
import { countIn, drumBar } from './drums'
import type { Form } from './form'
import { pianoBar } from './piano'
import { barRng } from './rng'
import { type BandStyle, swingAt } from './styles'
import type { BandEvent, BarCtx } from './types'

export interface ArrangeOptions {
  style: BandStyle
  bpm: number
  seed?: number
}

export class Arranger {
  style: BandStyle
  bpm: number
  readonly seed: number
  private lastBar = -2
  private bassPrev: number | null = null
  private pianoPrev: number[] | null = null

  constructor(
    readonly form: Form,
    opts: ArrangeOptions,
  ) {
    this.style = opts.style
    this.bpm = opts.bpm
    this.seed = opts.seed ?? 1
  }

  /** Every event of bar `i`, beats from the start of the form, sorted by beat. */
  bar(i: number): BandEvent[] {
    if (i < 0 || i >= this.form.bars.length) return []
    if (i !== this.lastBar + 1) {
      this.bassPrev = null
      this.pianoPrev = null
    }
    this.lastBar = i
    const ctx = (salt: number): BarCtx => ({
      form: this.form,
      barIndex: i,
      style: this.style,
      bpm: this.bpm,
      swing: swingAt(this.style, this.bpm),
      rng: barRng(this.seed, i, salt),
    })
    const bass = bassBar(ctx(1), this.bassPrev)
    this.bassPrev = bass.last
    const piano = pianoBar(ctx(2), this.pianoPrev)
    this.pianoPrev = piano.last
    const drums = drumBar(ctx(3))
    return [...bass.events, ...piano.events, ...drums].sort((a, b) => a.beat - b.beat)
  }

  /** Count-in clicks before beat 0 (negative beats). */
  countIn(bars: number): BandEvent[] {
    return countIn(bars, this.form.meterNum)
  }
}
