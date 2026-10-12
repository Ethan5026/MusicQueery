// Song map (M8, sketch "Song map"): the whole recording as rows of bars coloured by key. A chart-derived timeline
// (band, drills, a linked chart) gets one row per pass: intro, each chorus, ending, with its rehearsal letters as
// ticks. A recording without passes (P-05: analysed tracks carry no sections) gets rows of 16 bars. Key areas
// total the bars per key, over one chorus when there is a form, else over the track. Pure, built once per
// timeline and instrument.
import type { Timeline } from '@mq/model'
import { type InstrumentId, type Key, analyseTimeline, noteName, pc, toWritten } from '@mq/theory'

export interface MapBar {
  /** index into timeline.bars */
  index: number
  startMs: number
  endMs: number
  /** concert key id ("C|major"), null where no chord sounds */
  key: string | null
  hue: number | null
}

export interface MapRow {
  name: string
  /** second line under the name (bars or time) */
  sub: string | null
  bars: MapBar[]
  startMs: number
  endMs: number
  /** rehearsal letters starting in this row, at their bar offset */
  ticks: Array<{ label: string; at: number }>
  /** pass number for chorus rows */
  pass: number | null
}

export interface KeyArea {
  id: string
  /** written for the instrument */
  name: string
  hue: number
  bars: number
  home: boolean
}

export interface SongMap {
  rows: MapRow[]
  /** row of each timeline bar */
  rowOf: number[]
  keys: KeyArea[]
  keysScope: 'chorus' | 'track'
  /** longest row, in bars: strips are drawn to this scale */
  widest: number
}

export const BARS_PER_ROW = 16

/** Circle-of-fifths hue (the sketch's fifthsHue); a minor key takes its relative major's, so related keys look alike. */
export function keyHue(tonicPc: number, mode: Key['mode']): number {
  const major = mode === 'minor' ? (tonicPc + 3) % 12 : tonicPc
  return ((major * 7) % 12) * 30 + 25
}

const keyId = (k: Key): string => `${noteName(k.tonic)}|${k.mode}`

const fmt = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The repeated span of chart bars (a chorus), as in view.ts. */
function formOf(tl: Timeline): { start: number; end: number } | null {
  const seen = new Map<number, number>()
  for (const b of tl.bars) if (b.chartBar !== undefined) seen.set(b.chartBar, (seen.get(b.chartBar) ?? 0) + 1)
  const rep = [...seen].filter(([, n]) => n > 1).map(([i]) => i)
  return rep.length ? { start: Math.min(...rep), end: Math.max(...rep) } : null
}

export function buildMap(tl: Timeline, inst: InstrumentId): SongMap {
  const ev = analyseTimeline(tl).events
  const keys = new Map<string, Key>()
  // the key and chord at each bar's middle
  const bars: MapBar[] = []
  let e = 0
  for (let i = 0; i < tl.bars.length; i++) {
    const startMs = tl.bars[i]!.startMs
    const endMs = tl.bars[i + 1]?.startMs ?? tl.durationMs
    const mid = (startMs + endMs) / 2
    while (e < ev.length && ev[e]!.endMs <= mid) e++
    const x = ev[e]
    const sounding = x && x.startMs <= mid && x.chord.kind === 'chord' ? x : null
    let key: string | null = null
    let hue: number | null = null
    if (sounding) {
      key = keyId(sounding.key)
      keys.set(key, sounding.key)
      hue = keyHue(pc(sounding.key.tonic), sounding.key.mode)
    }
    bars.push({ index: i, startMs, endMs, key, hue })
  }

  const rows: MapRow[] = []
  const form = formOf(tl)
  const inForm = (i: number): boolean => {
    const cb = tl.bars[i]!.chartBar
    return !!form && cb !== undefined && cb >= form.start && cb <= form.end
  }
  if (form && tl.bars.some((_, i) => inForm(i))) {
    // one row per pass: what comes before the first chorus is the intro, after the last the ending
    const firstIn = tl.bars.findIndex((_, i) => inForm(i))
    let lastIn = -1
    for (let i = 0; i < tl.bars.length; i++) if (inForm(i)) lastIn = i
    let cur: { name: string; pass: number | null; from: number } | null = null
    const close = (to: number) => {
      if (cur && to > cur.from) rows.push(row(tl, bars, cur.from, to, cur.name, cur.pass))
    }
    for (let i = 0; i < tl.bars.length; i++) {
      const b = tl.bars[i]!
      const name = i < firstIn ? 'Intro' : i > lastIn ? 'Ending' : `Chorus ${b.pass ?? 1}`
      const pass = i < firstIn || i > lastIn ? null : (b.pass ?? 1)
      // a new pass starts where the form restarts
      const restart = cur && pass !== null && b.chartBar === form.start && i > cur.from
      if (!cur || cur.name !== name || restart) {
        close(i)
        cur = { name, pass, from: i }
      }
    }
    close(tl.bars.length)
  } else {
    for (let from = 0; from < tl.bars.length; from += BARS_PER_ROW) {
      const to = Math.min(tl.bars.length, from + BARS_PER_ROW)
      const r = row(tl, bars, from, to, fmt(tl.bars[from]!.startMs), null)
      r.sub = `bars ${tl.bars[from]!.number}–${tl.bars[to - 1]!.number}`
      rows.push(r)
    }
  }
  const rowOf: number[] = []
  rows.forEach((r, k) => r.bars.forEach((b) => (rowOf[b.index] = k)))

  // key areas: one chorus when there is a form, else the whole track
  const firstChorus = rows.find((r) => r.pass !== null)
  const scope = firstChorus ? firstChorus.bars : bars
  const count = new Map<string, number>()
  for (const b of scope) if (b.key) count.set(b.key, (count.get(b.key) ?? 0) + 1)
  const sorted = [...count].sort((a, b) => b[1] - a[1])
  const areas: KeyArea[] = sorted.map(([id, n], k) => {
    const key = keys.get(id)!
    return {
      id,
      name: `${noteName(toWritten(key.tonic, inst))} ${key.mode}`,
      hue: keyHue(pc(key.tonic), key.mode),
      bars: n,
      home: k === 0,
    }
  })
  return {
    rows,
    rowOf,
    keys: areas,
    keysScope: firstChorus ? 'chorus' : 'track',
    widest: Math.max(1, ...rows.map((r) => r.bars.length)),
  }
}

function row(tl: Timeline, bars: MapBar[], from: number, to: number, name: string, pass: number | null): MapRow {
  const ticks: MapRow['ticks'] = []
  for (let i = from; i < to; i++) {
    const s = tl.bars[i]!.section
    if (s && (i === from || tl.bars[i - 1]!.section !== s)) ticks.push({ label: s, at: i - from })
  }
  return {
    name,
    sub: null,
    bars: bars.slice(from, to),
    startMs: bars[from]!.startMs,
    endMs: bars[to - 1]!.endMs,
    ticks,
    pass,
  }
}

/** The span the Map's loop card offers at `barIndex`: the rehearsal section around it when there are letters, else
 *  its 8-bar phrase. */
export function loopSpan(tl: Timeline, map: SongMap, barIndex: number): { from: number; to: number; label: string } | null {
  const r = map.rows[map.rowOf[barIndex] ?? -1]
  if (!r) return null
  const b = tl.bars[barIndex]!
  if (b.section) {
    let from = barIndex
    while (from > r.bars[0]!.index && tl.bars[from - 1]!.section === b.section) from--
    let to = barIndex
    const last = r.bars[r.bars.length - 1]!.index
    while (to < last && tl.bars[to + 1]!.section === b.section) to++
    return { from, to, label: b.section }
  }
  const first = r.bars[0]!.index
  const from = first + Math.floor((barIndex - first) / 8) * 8
  const to = Math.min(r.bars[r.bars.length - 1]!.index, from + 7)
  return { from, to, label: `bars ${tl.bars[from]!.number}–${tl.bars[to]!.number}` }
}
