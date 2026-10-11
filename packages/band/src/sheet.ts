// A compact way to write built-in charts: bars split by `|`, chords by spaces (split evenly over the bar),
// `[Name]` starts a section. ASCII accidentals are fine: `Bbmaj7 | Am7b5 D7`.
import type { Bar, Chart, KeySig } from '@mq/model'
import { canonical } from '@mq/theory'

export function lead(text: string, beatsPerBar = 4): Bar[] {
  const bars: Bar[] = []
  let section: string | undefined
  for (const raw of text.split('|')) {
    let cell = raw.trim()
    const m = cell.match(/^\[([^\]]+)\]\s*/)
    if (m) {
      section = m[1]
      cell = cell.slice(m[0].length)
    }
    if (!cell) continue
    const syms = cell.split(/\s+/)
    const bar: Bar = {
      chords: syms.map((s) => {
        const c = canonical(s)
        if (!c) throw new Error(`bad chord ${s}`)
        return { symbol: c, beats: beatsPerBar / syms.length }
      }),
    }
    if (section) {
      bar.section = section
      section = undefined
    }
    bars.push(bar)
  }
  return bars
}

export interface SheetOptions {
  id: string
  title: string
  key: KeySig
  style: string
  tempo: number
  meter?: { num: number; den: 1 | 2 | 4 | 8 | 16 }
  composer?: string
  choruses?: number
}

export function sheet(o: SheetOptions, text: string): Chart {
  const meter = o.meter ?? { num: 4, den: 4 }
  return {
    schema: 'mq.chart/1',
    id: o.id,
    title: o.title,
    ...(o.composer ? { composer: o.composer } : {}),
    style: o.style,
    key: o.key,
    meter,
    tempo: o.tempo,
    ...(o.choruses ? { choruses: o.choruses } : {}),
    bars: lead(text, meter.num),
    source: { kind: 'manual' },
  }
}
