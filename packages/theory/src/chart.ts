// Chart v1 → playing order → exact Timeline v1, and transposition of whole charts.
import type { Chart, ChordSlot, KeySig, Meter, Timeline } from '@mq/model'
import { type ChordSymbol, formatChord, parseChord, transposeChord } from './chord'
import { type Interval, intervalBetween, noteName, note, transpose } from './pitch'
import { detectKeys } from './regions'

export interface PlayedBar {
  /** index into chart.bars */
  chartBar: number
  /** rehearsal mark in effect (score order) */
  section?: string
  /** 1-based bar number in playing order */
  number: number
  /** 1-based pass of the enclosing repeat (or chorus when played several times) */
  pass: number
  meter: Meter
  chords: ChordSlot[]
}

const MAX_BARS = 20000

/**
 * Plays the chart once through: repeats with voltas, then D.C./D.S. jumps (repeats are not taken again
 * after a jump, and the last volta is played), To Coda once a jump "al Coda" was taken, Fine after "al Fine".
 */
export function expandChart(chart: Chart): PlayedBar[] {
  const bars = chart.bars
  const sectionAt: Array<string | undefined> = []
  const meterAt: Meter[] = []
  let sec: string | undefined
  let meter = chart.meter
  bars.forEach((b, i) => {
    if (b.section) sec = b.section
    if (b.meter) meter = b.meter
    sectionAt[i] = sec
    meterAt[i] = meter
  })
  const segno = bars.findIndex((b) => b.segno)
  const codaIdx = bars.reduce((acc, b, i) => (b.coda ? i : acc), -1)

  const out: PlayedBar[] = []
  const repeat: Array<{ start: number; pass: number }> = []
  let afterJump = false
  let codaArmed = false
  let fineArmed = false
  const jumped = new Set<number>()
  let i = 0
  while (i < bars.length && out.length < MAX_BARS) {
    const b = bars[i]!
    if (b.repeatStart && !afterJump) {
      const top = repeat[repeat.length - 1]
      if (!top || top.start !== i) repeat.push({ start: i, pass: 1 })
    }
    const top = repeat[repeat.length - 1]
    if (b.ending !== undefined) {
      // Skip a volta that isn't for this pass: jump to the matching one (or the last one).
      const want = afterJump ? Infinity : (top?.pass ?? 1)
      if (b.ending !== want) {
        const endings: number[] = []
        for (let j = i; j < bars.length; j++) if (bars[j]!.ending !== undefined) endings.push(j)
        const match = endings.find((j) => bars[j]!.ending === want)
        const target = match ?? (want === Infinity || want > b.ending ? endings[endings.length - 1] : undefined)
        if (target !== undefined && target !== i) {
          i = target
          continue
        }
      }
    }
    out.push({
      chartBar: i,
      ...(sectionAt[i] !== undefined ? { section: sectionAt[i] } : {}),
      number: out.length + 1,
      pass: top?.pass ?? 1,
      meter: meterAt[i]!,
      chords: b.chords,
    })

    if (b.fine && fineArmed) break
    if (b.toCoda && codaArmed && codaIdx > i) {
      i = codaIdx
      codaArmed = false
      continue
    }
    if (b.repeatEnd !== undefined) {
      const times = b.repeatEnd ?? 2
      const cur = repeat[repeat.length - 1]
      if (!afterJump) {
        if (cur && cur.pass < times) {
          cur.pass++
          i = cur.start
          continue
        }
        if (!cur) {
          // repeat sign with no start: back to the top, once
          repeat.push({ start: 0, pass: 2 })
          i = 0
          continue
        }
      }
      repeat.pop()
    }
    if (b.jump && !jumped.has(i)) {
      jumped.add(i)
      afterJump = true
      repeat.length = 0
      codaArmed = b.jump.endsWith('Coda')
      fineArmed = b.jump.endsWith('Fine')
      i = b.jump.startsWith('D.S.') && segno >= 0 ? segno : 0
      continue
    }
    i++
  }
  return out
}

// ---------------------------------------------------------------- transposition

const mapSymbol = (s: string, f: (c: ChordSymbol) => ChordSymbol): string => {
  const c = parseChord(s)
  return c ? formatChord(f(c)) : s
}

export function transposeChartBy(chart: Chart, iv: Interval): Chart {
  const tr = (s: string): string => mapSymbol(s, (c) => transposeChord(c, iv))
  const key: KeySig = { tonic: noteName(transpose(note(chart.key.tonic), iv)), mode: chart.key.mode }
  return {
    ...chart,
    key,
    bars: chart.bars.map((b) => ({
      ...b,
      chords: b.chords.map((s) => ({ ...s, symbol: tr(s.symbol), ...(s.alt ? { alt: tr(s.alt) } : {}) })),
    })),
  }
}

/** Transposes a chart so its key's tonic becomes `tonic` (spelled as given). */
export function transposeChart(chart: Chart, tonic: string): Chart {
  return transposeChartBy(chart, intervalBetween(note(chart.key.tonic), note(tonic)))
}

// ---------------------------------------------------------------- timeline

export interface ChartTimelineOptions {
  bpm?: number
  /** times through the form; passes number 1..n */
  choruses?: number
  id?: string
  createdAt?: string
}

/** An exact Timeline for a chart played at a steady tempo (generated tracks, demos, tests). */
export function chartTimeline(chart: Chart, opts: ChartTimelineOptions = {}): Timeline {
  const bpm = opts.bpm ?? chart.tempo ?? 120
  const choruses = opts.choruses ?? chart.choruses ?? 1
  const beatMs = 60000 / bpm
  const once = expandChart(chart)
  const beats: number[] = []
  const bars: Timeline['bars'] = []
  const chords: Timeline['chords'] = []
  let t = 0
  for (let p = 1; p <= choruses; p++) {
    for (const pb of once) {
      bars.push({
        startMs: t,
        number: pb.number,
        ...(pb.section ? { section: pb.section } : {}),
        pass: choruses > 1 ? p : pb.pass,
        chartBar: pb.chartBar,
      })
      for (let k = 0; k < pb.meter.num; k++) beats.push(t + k * beatMs)
      let ct = t
      for (const slot of pb.chords) {
        const end = ct + slot.beats * beatMs
        const last = chords[chords.length - 1]
        if (last && last.symbol === slot.symbol && Math.abs(last.endMs - ct) < 1e-6) last.endMs = end
        else chords.push({ startMs: ct, endMs: end, symbol: slot.symbol })
        ct = end
      }
      t += pb.meter.num * beatMs
    }
  }
  const items = chords.map((c) => ({
    chord: parseChord(c.symbol) ?? { kind: 'nc' as const },
    beats: (c.endMs - c.startMs) / beatMs,
  }))
  const { regions } = detectKeys(items, { home: { tonic: note(chart.key.tonic), mode: chart.key.mode } })
  const keys: Timeline['keys'] = regions.map((r) => ({
    startMs: chords[r.start]!.startMs,
    endMs: chords[r.end - 1]!.endMs,
    tonic: noteName(r.key.tonic),
    mode: r.key.mode,
  }))
  return {
    schema: 'mq.timeline/1',
    id: opts.id ?? `chart:${chart.id}`,
    source: 'exact',
    durationMs: t,
    createdAt: opts.createdAt ?? new Date().toISOString(),
    generator: 'theory.chartTimeline',
    chartId: chart.id,
    meter: chart.meter,
    beats,
    bars,
    chords,
    keys,
    tempo: [{ startMs: 0, bpm }],
    edits: [],
  }
}
