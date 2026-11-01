// Soloist audit (M12, D-86): scores analysed timelines against truth the way a player feels them, with the app's own
// theory and Play-card code. Per beat of the truth: is the root / 3rd / 7th right, how bad is a wrong chord (wrong 3rd,
// unrelated root), does the scale each Play mode shows hold the real chord's root, 3rd and 7th, and are the steel guide
// tones (3rd, 7th) tones of the real chord. Human truths carry Harte labels (D-39); iReal truths chord text (D-37).
//
//   pnpm --filter @mq/web audit pairs.json
//   pairs.json: [["name", "path/to/truth.timeline.json", "path/to/analysed.json"], ...]

import { readFileSync } from 'node:fs'
import type { Timeline } from '@mq/model'
import { chordNotes, chordTones, fromHarte, moment, note, parseChord, pc } from '@mq/theory'
import { type PlayMode, playView } from '../src/ui/stand/play'

type Chord = Timeline['chords'][number] & { harte?: string }

interface Info {
  root: number
  third: number | null
  seventh: number | null
  tones: Set<number>
  all: Set<number>
}

function info(sym: string): Info | null {
  const c = parseChord(sym)
  if (!c || c.kind !== 'chord') return null
  const r = pc(c.root)
  const tones = chordTones(c)
  const at = (slot: string) => {
    const t = tones.find((x) => x.slot === slot)
    return t ? (r + t.semis) % 12 : null
  }
  return {
    root: r,
    third: at('3'),
    seventh: at('7'),
    tones: new Set(tones.map((t) => (r + t.semis) % 12)),
    all: new Set(chordNotes(c).map((t) => (r + t.semis) % 12)),
  }
}

const text = (c: Chord): string => (c.harte ? (fromHarte(c.harte) ?? 'N.C.') : c.symbol)

function load(path: string): Timeline {
  const tl = JSON.parse(readFileSync(path, 'utf8')) as Timeline & { chords: Chord[] }
  return { ...tl, edits: tl.edits ?? [], chords: tl.chords.map((c) => ({ startMs: c.startMs, endMs: c.endMs, symbol: text(c) })) }
}

const symAt = (tl: Timeline, t: number): string | null => tl.chords.find((c) => c.startMs <= t && t < c.endMs)?.symbol ?? null
const pcs = (names: string[]): Set<number> => new Set(names.map((n) => pc(note(n))))
const MODES: PlayMode[] = ['advanced', 'integrated', 'simple']
const prefs = { instrument: 'concert' as const, lens: 'inside' as const }

interface Score {
  name: string
  beats: number
  root: number
  third: number
  sev: number
  sevN: number
  wrong3: number
  unrelated: number
  noChord: number
  badBars: number
  bars: number
  miss: Record<PlayMode, number>
  guide: number
  guideBad: number
}

const empty = (name: string): Score => ({
  name, beats: 0, root: 0, third: 0, sev: 0, sevN: 0, wrong3: 0, unrelated: 0, noChord: 0, badBars: 0, bars: 0,
  miss: { advanced: 0, integrated: 0, simple: 0 }, guide: 0, guideBad: 0,
})

function score(name: string, truth: Timeline, est: Timeline): Score {
  const s = empty(name)
  const bad = new Map<number, boolean>()
  for (let i = 0; i + 1 < truth.beats.length; i++) {
    const t = (truth.beats[i]! + truth.beats[i + 1]!) / 2
    const ts = symAt(truth, t)
    const ti = ts && ts !== 'N.C.' ? info(ts) : null
    if (!ti) continue
    s.beats++
    const bar = i >> 2
    if (!bad.has(bar)) bad.set(bar, false)
    const es = symAt(est, t)
    const ei = es && es !== 'N.C.' ? info(es) : null
    let harmful = !ei
    if (!ei) s.noChord++
    else {
      const rootOk = ei.root === ti.root
      const thirdOk = rootOk && ei.third === ti.third
      s.root += +rootOk
      s.third += +thirdOk
      if (ti.seventh !== null) {
        s.sevN++
        s.sev += +(thirdOk && ei.seventh === ti.seventh)
      }
      if (rootOk && !thirdOk) {
        s.wrong3++
        harmful = true
      } else if (!rootOk && [...ei.tones].filter((p) => ti.tones.has(p)).length < 2) {
        s.unrelated++
        harmful = true
      }
      for (const g of [ei.third, ei.seventh]) {
        if (g === null) continue
        s.guide++
        s.guideBad += +!ti.all.has(g)
      }
    }
    if (harmful) bad.set(bar, true)
    const need = [ti.root, ti.third, ti.seventh].filter((x): x is number => x !== null)
    const m = moment(est, t, prefs)
    for (const mode of MODES) {
      const v = playView(m, mode)
      const shown = v ? pcs(v.notes.map((x) => x.name)) : null
      s.miss[mode] += +(!shown || need.some((p) => !shown.has(p)))
    }
  }
  s.bars = bad.size
  s.badBars = [...bad.values()].filter(Boolean).length
  return s
}

const pct = (a: number, b: number): string => (b ? ((100 * a) / b).toFixed(1) : '-').padStart(6)
const pairs = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Array<[string, string, string]>
const rows = pairs.map(([name, t, e]) => score(name, load(t), load(e)))
const total = empty('ALL')
for (const r of rows) {
  for (const k of ['beats', 'root', 'third', 'sev', 'sevN', 'wrong3', 'unrelated', 'noChord', 'badBars', 'bars', 'guide', 'guideBad'] as const)
    total[k] += r[k]
  for (const m of MODES) total.miss[m] += r.miss[m]
}
console.log(`${'song'.padEnd(40)}  root   3rd  7ths  wrong3 unrel  badBar  scale lacks a chord tone: adv  int  simple  guideBad`)
for (const r of [...rows, total])
  console.log(
    `${r.name.slice(0, 40).padEnd(40)}${pct(r.root, r.beats)}${pct(r.third, r.beats)}${pct(r.sev, r.sevN)}${pct(r.wrong3, r.beats)}${pct(r.unrelated, r.beats)}${pct(r.badBars, r.bars)}                        ${pct(r.miss.advanced, r.beats)}${pct(r.miss.integrated, r.beats)}${pct(r.miss.simple, r.beats)}${pct(r.guideBad, r.guide)}`,
  )
