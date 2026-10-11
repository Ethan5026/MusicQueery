// iReal Pro import (D-20, SP6): irealb:// playlist → songs → Chart v1.
// Format notes (cf. pianosnake/ireal-reader, infojunkie/ireal-musicxml): the music field starts with
// "1r34LbKcu7" and is scrambled in 50-char blocks; XyQ / LZ / Kcl are padding, barline and bar-repeat
// tokens. Each chord, blank, p, x, W or n fills one cell; a chord lasts 1 beat plus the blank cells after
// it, and leftover beats go round-robin from the first (non-small) chord.
import type { Bar, Chart, ChordSlot, Jump, KeySig, Meter } from '@mq/model'
import { formatChord, parseChord } from './chord'
import { noteName, parseNote } from './pitch'

export interface IrealSong {
  title: string
  composer: string
  style: string
  /** iReal key: `Eb`, `C-` */
  key: string
  transpose: number
  compStyle: string
  bpm: number
  repeats: number
  /** unscrambled music string */
  music: string
}

export interface IrealPlaylist {
  name?: string
  songs: IrealSong[]
}

const MUSIC_PREFIX = '1r34LbKcu7'

function obfusc50(s: string): string {
  const a = s.split('')
  for (let i = 0; i < 5; i++) {
    a[49 - i] = s[i]!
    a[i] = s[49 - i]!
  }
  for (let i = 10; i < 24; i++) {
    a[49 - i] = s[i]!
    a[i] = s[49 - i]!
  }
  return a.join('')
}

/** Undoes the 50-char block scrambling (a final block of 50 or 51 chars is left alone). */
export function unscramble(s: string): string {
  let r = ''
  while (s.length > 51) {
    r += obfusc50(s.slice(0, 50))
    s = s.slice(50)
  }
  return r + s
}

/** The scrambling is its own inverse; exported for tests. */
export const scramble = unscramble

const fixTitle = (t: string): string => t.trim().replace(/^(.*), (A|An|The)$/, '$2 $1')
const fixComposer = (c: string): string => {
  const parts = c.trim().split(/\s+/)
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : c.trim()
}

/** Finds the irealb:// (or irealbook://) link in text or HTML and splits it into songs. */
export function parsePlaylist(text: string): IrealPlaylist {
  const m = /(irealb(?:ook)?):\/\/([^"'<>\s]*)/.exec(text)
  if (!m) throw new Error('no irealb:// link found')
  let decoded: string
  try {
    decoded = decodeURIComponent(m[2]!)
  } catch {
    decoded = decodeURIComponent(m[2]!.replace(/%(?![0-9a-fA-F]{2})/g, '%25'))
  }
  const parts = decoded.split('===')
  const name = parts.length > 1 ? parts.pop() : undefined
  const songs = parts.filter((p) => p.trim()).map((p) => parseSong(p, m[1] === 'irealbook'))
  return name ? { name, songs } : { songs }
}

function parseSong(data: string, oldFormat: boolean): IrealSong {
  const f = data.split('=')
  const at = f.findIndex((x) => x.startsWith(MUSIC_PREFIX))
  if (at < 0 || oldFormat) {
    // irealbook://Title=Composer=Style=Key=n=Music
    return {
      title: fixTitle(f[0] ?? ''),
      composer: fixComposer(f[1] ?? ''),
      style: (f[2] ?? '').trim(),
      key: f[3] ?? 'C',
      transpose: 0,
      compStyle: '',
      bpm: 0,
      repeats: 0,
      music: (f[5] ?? f[4] ?? '').replace(/Kcl/g, '| x').replace(/LZ/g, ' |').replace(/XyQ/g, '   '),
    }
  }
  // irealb://Title=Composer==Style=Key=Transpose=1r34LbKcu7Music=CompStyle=BPM=Repeats
  const music = unscramble(f[at]!.slice(MUSIC_PREFIX.length))
  return {
    title: fixTitle(f[0] ?? ''),
    composer: fixComposer(f[1] ?? ''),
    style: (f[at - 3] ?? '').trim(),
    key: f[at - 2] ?? 'C',
    transpose: Number(f[at - 1]) || 0,
    compStyle: f[at + 1] ?? '',
    bpm: Number(f[at + 2]) || 0,
    repeats: Number(f[at + 3]) || 0,
    music: music.replace(/Kcl/g, '| x').replace(/LZ/g, ' |').replace(/XyQ/g, '   '),
  }
}

// ---------------------------------------------------------------- music → bars

type Cell =
  | { kind: 'chord'; symbol: string; alt?: string; small: boolean }
  | { kind: 'empty' }
  | { kind: 'x' }
  | { kind: 'r' }

interface Building {
  cells: Cell[]
  attrs: Partial<Omit<Bar, 'chords'>>
  opened: boolean
  q: boolean
  comments: string[]
}

const CHORD_RE = /^([A-G][b#]?)((?:sus|alt|add|[+\-^\dhob#])*)(\*[^*]*\*)?(\/[A-G][#b]?)?/
const SECTION_NAMES: Record<string, string> = { i: 'Intro', v: 'Verse' }

function meterOf(t: string): Meter | null {
  const MAP: Record<string, Meter> = {
    '12': { num: 12, den: 8 },
    '22': { num: 2, den: 2 },
    '32': { num: 3, den: 2 },
  }
  if (MAP[t]) return MAP[t]!
  const num = Number(t[0])
  const den = Number(t[1])
  if (!num || ![1, 2, 4, 8, 16].includes(den)) return null
  return { num, den: den as Meter['den'] }
}

function jumpOf(comment: string): Jump | 'fine' | null {
  const c = comment.replace(/\s+/g, ' ').trim().toLowerCase()
  const dc = /\bd\.? ?c\.?(?=$|\s)/.test(c)
  const ds = /\bd\.? ?s\.?(?=$|\s)/.test(c)
  if (dc || ds) {
    const base = dc ? 'D.C.' : 'D.S.'
    if (/al coda/.test(c)) return `${base} al Coda` as Jump
    if (/al fine/.test(c)) return `${base} al Fine` as Jump
    return base as Jump
  }
  if (/^fine$/.test(c)) return 'fine'
  return null
}

export function keyOf(k: string): KeySig | null {
  const m = /^([A-G][b#]?)(-?)$/.exec(k.trim())
  if (!m) return null
  const n = parseNote(m[1]!)
  return n ? { tonic: noteName(n), mode: m[2] ? 'minor' : 'major' } : null
}

/** Canonical symbol for an iReal chord token, or null. */
export function irealChord(token: string): string | null {
  const c = parseChord(token)
  return c ? formatChord(c) : null
}

function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

const slug = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .slice(0, 60)

export interface ImportResult {
  chart: Chart
  issues: string[]
}

/** Converts one song to a Chart v1. `issues` lists anything not understood (unparsed chords first). */
export function songToChart(song: IrealSong, playlist?: string): ImportResult {
  const issues: string[] = []
  const bars: Building[] = []
  const done: Bar[] = []
  let cur: Building | null = null
  let carry: Building['attrs'] = {}
  let carryComments: string[] = []
  let small = false
  let lastChord: string | null = null // iReal text of the last real chord (root + quality)
  let meter: Meter | null = null // the chart's opening meter
  let running: Meter | null = null // the meter in force, in written order
  let pendingR: ChordSlot[] | null = null
  let lastEnding = 0
  const qBars: number[] = []

  const newBar = (opened: boolean): Building => {
    const b: Building = { cells: [], attrs: { ...carry }, opened, q: false, comments: carryComments }
    carry = {}
    carryComments = []
    return b
  }
  const ensure = (): Building => (cur ??= newBar(false))

  const finish = (b: Building, closedByBarline: boolean): void => {
    const chords = b.cells.filter((c) => c.kind === 'chord')
    let slots: ChordSlot[] | null = null
    let simile = false
    if (b.attrs.meter) running = b.attrs.meter
    const beatsPerBar = (running ?? { num: 4 }).num
    if (b.cells.some((c) => c.kind === 'x')) {
      slots = done[done.length - 1]?.chords ?? null
      simile = true
      pendingR = null
    } else if (b.cells.some((c) => c.kind === 'r')) {
      // two-bar repeat: this bar plays the bar before last, the (blank) next bar plays the last one
      slots = done[done.length - 2]?.chords ?? null
      pendingR = done[done.length - 1]?.chords ?? null
      simile = true
    } else if (chords.length === 0) {
      if (pendingR) {
        slots = pendingR
        simile = true
        pendingR = null
      } else if (b.opened && closedByBarline && done.length) {
        const prev = done[done.length - 1]!.chords
        slots = [{ symbol: prev[prev.length - 1]!.symbol, beats: beatsPerBar }]
      }
    } else {
      slots = durations(b.cells, beatsPerBar, issues, song.title)
      pendingR = null
    }
    if (!slots) {
      // nothing to play: keep markers for the next bar (or the previous one for a closing repeat)
      const { repeatEnd, ...rest } = b.attrs
      if (repeatEnd && done.length) done[done.length - 1]!.repeatEnd = repeatEnd
      carry = { ...rest, ...carry }
      carryComments = [...b.comments, ...carryComments]
      if (b.q) qBars.push(done.length)
      return
    }
    const bar: Bar = { chords: slots.map((s) => ({ ...s })), ...b.attrs }
    if (simile) bar.simile = true
    for (const c of b.comments) {
      const j = jumpOf(c)
      if (j === 'fine') bar.fine = true
      else if (j) bar.jump = j
      else {
        const times = /^(\d+)\s*x$/i.exec(c.trim())
        if (times) bar.repeatEnd = Math.min(16, Math.max(2, Number(times[1])))
        bar.comment = bar.comment ? `${bar.comment}; ${c}` : c
      }
    }
    if (b.q) qBars.push(done.length)
    bars.push(b)
    done.push(bar)
  }

  const close = (closedByBarline: boolean): void => {
    if (cur) finish(cur, closedByBarline)
    cur = null
  }

  const s = song.music
  let i = 0
  while (i < s.length) {
    const ch = s[i]!
    const rest = s.slice(i)
    let m: RegExpExecArray | null
    if (ch === '|' || ch === '[' || ch === '{') {
      close(true)
      cur = newBar(true)
      if (ch === '{') cur.attrs.repeatStart = true
      i++
    } else if (ch === ']' || ch === 'Z') {
      close(true)
      i++
    } else if (ch === '}') {
      const b = ensure()
      b.attrs.repeatEnd = b.attrs.repeatEnd ?? 2
      close(true)
      i++
    } else if ((m = /^T(\d\d)/.exec(rest))) {
      const mt = meterOf(m[1]!)
      if (!mt) issues.push(`unknown time signature T${m[1]}`)
      else {
        if (meter === null) meter = mt
        ensure().attrs.meter = mt
      }
      i += m[0].length
    } else if ((m = /^\*(\w)/.exec(rest))) {
      ensure().attrs.section = SECTION_NAMES[m[1]!] ?? m[1]!.toUpperCase()
      i += 2
    } else if ((m = /^<([^>]*)>/.exec(rest))) {
      const text = m[1]!.replace(/^\*\d+/, '').trim()
      if (text) ensure().comments.push(text)
      i += m[0].length
    } else if ((m = /^N(\d)/.exec(rest))) {
      const n = Number(m[1]) || lastEnding + 1
      lastEnding = n
      ensure().attrs.ending = n
      i += 2
    } else if ((m = CHORD_RE.exec(rest))) {
      const text = m[1]! + m[2]! + (m[4] ?? '')
      const sym = irealChord(text)
      if (!sym) issues.push(`unparsed chord ${text}`)
      else ensure().cells.push({ kind: 'chord', symbol: sym, small })
      lastChord = m[1]! + m[2]!
      i += m[0].length
    } else if ((m = /^W(\/[A-G][b#]?)?/.exec(rest))) {
      const text = lastChord ? lastChord + (m[1] ?? '') : null
      const sym = text ? irealChord(text) : null
      if (sym) ensure().cells.push({ kind: 'chord', symbol: sym, small })
      else ensure().cells.push({ kind: 'empty' })
      i += m[0].length
    } else if (ch === '(') {
      const end = s.indexOf(')', i)
      const inner = end > i ? s.slice(i + 1, end) : ''
      const alt = irealChord(inner.replace(/\*[^*]*\*/g, ''))
      const b = ensure()
      const last = b.cells[b.cells.length - 1]
      if (alt && last?.kind === 'chord') last.alt = alt
      else if (alt) b.cells.push({ kind: 'empty' })
      i = end > i ? end + 1 : i + 1
    } else if (ch === ' ') {
      if (cur) cur.cells.push({ kind: 'empty' })
      i++
    } else if (ch === 'p') {
      const b = ensure()
      const prev = [...b.cells].reverse().find((c) => c.kind === 'chord')
      const symbol = prev?.kind === 'chord' ? prev.symbol : lastChord ? irealChord(lastChord) : null
      b.cells.push(symbol ? { kind: 'chord', symbol, small } : { kind: 'empty' })
      i++
    } else if (ch === 'x') {
      ensure().cells.push({ kind: 'x' })
      i++
    } else if (ch === 'r') {
      ensure().cells.push({ kind: 'r' })
      i++
    } else if (ch === 'n') {
      ensure().cells.push({ kind: 'chord', symbol: 'N.C.', small })
      i++
    } else if (ch === 'S') {
      ensure().attrs.segno = true
      i++
    } else if (ch === 'Q') {
      ensure().q = true
      i++
    } else if (ch === 'f') {
      ensure().attrs.fermata = true
      i++
    } else if (ch === 'U') {
      ensure().attrs.end = true
      i++
    } else if (ch === 's') {
      small = true
      i++
    } else if (ch === 'l') {
      small = false
      i++
    } else if (ch === 'Y' || ch === ',' || ch === '\n' || ch === '\r') {
      i++
    } else {
      issues.push(`unknown token ${JSON.stringify(ch)} at ${i}`)
      i++
    }
  }
  close(false)
  if (carry.repeatEnd && done.length) done[done.length - 1]!.repeatEnd = carry.repeatEnd

  // Coda: the last Q is the coda itself, earlier ones are "To Coda" (one Q after an "al Coda" jump is the coda).
  const qs = [...new Set(qBars)].filter((q) => q < done.length)
  if (qs.length) {
    const last = qs[qs.length - 1]!
    const jumpBefore = done.findIndex((b, idx) => idx < last && b.jump?.endsWith('Coda'))
    if (qs.length > 1 || jumpBefore >= 0) done[last]!.coda = true
    for (const q of qs.slice(0, qs.length > 1 || jumpBefore >= 0 ? -1 : undefined)) done[q]!.toCoda = true
  }

  const key = keyOf(song.key)
  if (!key) issues.push(`unknown key ${song.key}`)
  if (done.length === 0) {
    issues.push('no bars')
    done.push({ chords: [{ symbol: 'N.C.', beats: 4 }] })
  }
  const chartMeter = meter ?? { num: 4, den: 4 }
  // drop meter markers that don't change anything
  let eff: Meter = chartMeter
  for (const b of done) {
    if (b.meter && b.meter.num === eff.num && b.meter.den === eff.den) delete b.meter
    else if (b.meter) eff = b.meter
  }
  const chart: Chart = {
    schema: 'mq.chart/1',
    id: `ireal-${slug(song.title) || 'untitled'}-${hash(song.title + '|' + song.composer + '|' + song.music)}`,
    title: song.title || 'Untitled',
    ...(song.composer ? { composer: song.composer } : {}),
    ...(song.style ? { style: song.style } : {}),
    key: key ?? { tonic: 'C', mode: 'major' },
    meter: chartMeter,
    ...(song.bpm > 0 ? { tempo: Math.min(400, song.bpm) } : {}),
    ...(song.repeats > 0 ? { choruses: Math.min(99, song.repeats) } : {}),
    bars: done,
    source: { kind: 'ireal', ...(playlist ? { playlist } : {}), raw: song.music },
  }
  return { chart, issues }
}

/** Chord cells → slots: 1 beat each plus following blanks, then trimmed or padded round-robin to the bar. */
function durations(cells: Cell[], beatsPerBar: number, issues: string[], title: string): ChordSlot[] {
  const slots: Array<{ symbol: string; alt?: string; beats: number; small: boolean }> = []
  for (const c of cells) {
    if (c.kind === 'chord') slots.push({ symbol: c.symbol, ...(c.alt ? { alt: c.alt } : {}), beats: 1, small: c.small })
    else if (c.kind === 'empty' && slots.length) slots[slots.length - 1]!.beats++
  }
  if (slots.length > beatsPerBar) {
    issues.push(`${title}: ${slots.length} chords in a ${beatsPerBar}-beat bar`)
    for (const s of slots) s.beats = beatsPerBar / slots.length
  } else {
    let total = slots.reduce((a, s) => a + s.beats, 0)
    for (let k = 0; total > beatsPerBar; k = (k + 1) % slots.length) {
      if (slots[k]!.beats > 1) {
        slots[k]!.beats--
        total--
      }
    }
    let changed = true
    for (let k = 0; total < beatsPerBar; k = (k + 1) % slots.length) {
      if (k === 0) {
        if (!changed) {
          slots[slots.length - 1]!.beats += beatsPerBar - total
          break
        }
        changed = false
      }
      if (!slots[k]!.small) {
        slots[k]!.beats++
        total++
        changed = true
      }
    }
  }
  // merge repeated slashes (C7 p p p) into one slot
  const out: ChordSlot[] = []
  for (const s of slots) {
    const last = out[out.length - 1]
    if (last && last.symbol === s.symbol && !s.alt && !last.alt) last.beats += s.beats
    else out.push({ symbol: s.symbol, beats: s.beats, ...(s.alt ? { alt: s.alt } : {}) })
  }
  return out
}

/** Imports every song of a playlist. */
export function importPlaylist(text: string): { name?: string; results: ImportResult[] } {
  const pl = parsePlaylist(text)
  return { ...(pl.name ? { name: pl.name } : {}), results: pl.songs.map((s) => songToChart(s, pl.name)) }
}
