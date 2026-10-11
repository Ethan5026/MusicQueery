// M7 / SP7 evaluation: runs the live decoder on the companion's truth recordings (%LOCALAPPDATA%\MusicQueery\work\truth,
// kept on the PC only, D-18) and scores it per beat against the human annotations (D-39), MIREX rules.
//   pnpm --filter @mq/listen eval [--room] [--oracle] [--names a,b] [--all] [--json out.json]
// --room plays the audio "over speakers": speaker band-pass, a synthetic room, mic noise (see room.ts).
// --oracle uses the truth beat grid instead of the live beat tracker (the chroma + HMM ceiling).
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LiveDecoder } from '../src/live'
import { decodeOffline, type OfflineOptions } from '../src/offline'
import { simulateRoom } from '../src/room'
import { scoreBeats, type Scores, type Span } from '../src/score'

const REPO = join(import.meta.dirname, '..', '..', '..')
const TRUTH = join(REPO, 'companion', 'truth')
const AUDIO = join(process.env.LOCALAPPDATA ?? '', 'MusicQueery', 'work', 'truth')
const SR = 44100
const predPending: { t: number; symbol: string }[] = []
const liveRows: { shown: number; shownS: number; final: number; finalS: number; lat: number; within: number }[] = []

const args = process.argv.slice(2)
const flag = (f: string) => args.includes(f)
const opt = (f: string) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}

interface TruthTl {
  beats: number[]
  chords: Span[]
  generator?: string
}

function readAudio(name: string): Float32Array {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', join(AUDIO, `${name}.flac`), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30,
  })
  if (r.status !== 0) throw new Error(String(r.stderr))
  const b = r.stdout as Buffer
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice()
}

const all = readdirSync(TRUTH)
  .filter((f) => f.endsWith('.timeline.json'))
  .map((f) => f.replace('.timeline.json', ''))
const names = opt('--names')?.split(',') ?? all
const results: Record<string, Scores & { tuning: number; ms: number }> = {}
const options: OfflineOptions = {
  oracleBeats: flag('--oracle'),
  ...(opt('--params') ? JSON.parse(opt('--params')!) : {}),
}
for (const name of names) {
  const tl = JSON.parse(readFileSync(join(TRUTH, `${name}.timeline.json`), 'utf8')) as TruthTl
  const human = tl.chords.some((c) => c.harte !== undefined)
  if (!human && !flag('--all')) continue
  let audio = readAudio(name)
  if (flag('--room')) audio = simulateRoom(audio, SR, { seed: name.length })
  if (flag('--live')) {
    live(name, audio, tl)
    continue
  }
  const t0 = performance.now()
  const out = decodeOffline(audio, SR, { ...options, truthBeats: tl.beats })
  const ms = performance.now() - t0
  const s = scoreBeats(tl.chords, tl.beats, out.chords)
  const ibi = (b: number[]) => {
    const d = b.slice(1).map((x, i) => x - b[i]!).sort((x, y) => x - y)
    return d[d.length >> 1] ?? 0
  }
  if (flag('--bpm')) console.log(`  bpm truth ${(60000 / ibi(tl.beats)).toFixed(1)} tracked ${(60000 / ibi(out.beats)).toFixed(1)}`)
  results[name] = { ...s, tuning: out.tuning, ms }
  console.log(
    `${name.padEnd(36)} root ${pct(s.root)}  majmin ${pct(s.majmin)}  sevenths ${pct(s.sevenths)}  ` +
      `(${s.beats} beats, tuning ${out.tuning.toFixed(2)}, ${(ms / 1000).toFixed(1)} s${out.beatF !== undefined ? `, beat F ${out.beatF.toFixed(3)}` : ''})`,
  )
}
const vals = Object.values(results)
const mean = (k: 'root' | 'majmin' | 'sevenths') => vals.reduce((a, r) => a + r[k], 0) / Math.max(1, vals.length)
console.log(`${'MEAN'.padEnd(36)} root ${pct(mean('root'))}  majmin ${pct(mean('majmin'))}  sevenths ${pct(mean('sevenths'))}`)
if (opt('--json')) writeFileSync(opt('--json')!, JSON.stringify({ options, results }, null, 1))

/** Streams the audio through LiveDecoder as the phone would and scores what was shown, settled and finished. */
function live(name: string, audio: Float32Array, tl: TruthTl): void {
  const t0 = performance.now()
  const dec = new LiveDecoder({ sampleRate: SR, ...(opt('--live-params') ? JSON.parse(opt('--live-params')!) : {}) })
  const shown: Span[] = []
  const chunk = 2048
  let predHits = 0
  let predN = 0
  for (let i = 0; i < audio.length; i += chunk) {
    dec.push(audio.subarray(i, i + chunk))
    const now = dec.now()
    const t = (i + chunk) / SR
    const ms = t * 1000
    const sym = now.symbol ?? 'N.C.'
    const last = shown[shown.length - 1]
    if (last && last.symbol === sym) last.endMs = ms
    else {
      if (last) last.endMs = ms
      shown.push({ startMs: ms, endMs: ms + (chunk / SR) * 1000, symbol: sym })
    }
    // Predicted: every ~2 s, check the chord expected 2 beats ahead once that time comes (scored later)
    if (i % (chunk * 20) === 0 && now.predicted.length) {
      const target = now.predicted.find((c) => c.start <= t + 1.0 && c.end > t + 1.0)
      if (target) {
        predN++
        predPending.push({ t: (t + 1.0) * 1000, symbol: target.symbol })
      }
    }
  }
  const fin = dec.finish()
  const ms = performance.now() - t0
  const toSpans = (cs: { start: number; end: number; symbol: string }[]) =>
    cs.map((c) => ({ startMs: c.start * 1000, endMs: c.end * 1000, symbol: c.symbol }))
  const sShown = scoreBeats(tl.chords, tl.beats, shown)
  const sSettled = scoreBeats(tl.chords, tl.beats, toSpans(dec.settledChords()))
  const sFinal = scoreBeats(tl.chords, tl.beats, toSpans(fin.chords))
  for (const p of predPending.splice(0)) {
    const sc = scoreBeats(tl.chords, [p.t - 1, p.t + 1], [{ startMs: p.t - 2, endMs: p.t + 2, symbol: p.symbol }])
    if (sc.majminN) predHits += sc.majmin
    else predN--
  }
  const lat = latency(tl, shown)
  console.log(
    `${name.padEnd(36)} shown ${pct(sShown.majmin)} / ${pct(sShown.sevenths)}  settled ${pct(sSettled.majmin)}  final ${pct(sFinal.majmin)} / ${pct(sFinal.sevenths)}  ` +
      `latency median ${lat.median.toFixed(0)} ms (${(lat.within * 100).toFixed(0)}% ≤ 1 beat)  predicted ${predN ? pct(predHits / predN) : '  —  '} (${predN})  ${(ms / 1000).toFixed(1)} s`,
  )
  liveRows.push({ shown: sShown.majmin, shownS: sShown.sevenths, final: sFinal.majmin, finalS: sFinal.sevenths, lat: lat.median, within: lat.within })
}

process.on('beforeExit', () => {
  if (!liveRows.length) return
  const m = (k: keyof (typeof liveRows)[0]) => liveRows.reduce((a, r) => a + r[k], 0) / liveRows.length
  console.log(
    `MEAN shown majmin ${pct(m('shown'))} sevenths ${pct(m('shownS'))} · final majmin ${pct(m('final'))} sevenths ${pct(m('finalS'))} · latency ${m('lat').toFixed(0)} ms, ${(m('within') * 100).toFixed(0)}% within a beat`,
  )
  liveRows.length = 0
})

/** For each truth chord change, how long until the shown chord matched the new chord (majmin), if it did. */
function latency(tl: TruthTl, shown: Span[]): { median: number; within: number } {
  const delays: number[] = []
  let within = 0
  let n = 0
  const beat = (tl.beats[tl.beats.length - 1]! - tl.beats[0]!) / Math.max(1, tl.beats.length - 1)
  for (let k = 1; k < tl.chords.length; k++) {
    const c = tl.chords[k]!
    if (!c.harte || c.harte === 'N' || c.endMs - c.startMs < 2 * beat) continue
    const truthOnly = [c]
    let found: number | null = null
    for (const s of shown) {
      if (s.endMs <= c.startMs - 300 || s.startMs >= c.endMs) continue
      const sc = scoreBeats(truthOnly, [Math.max(s.startMs, c.startMs) - 1, Math.max(s.startMs, c.startMs) + 1], [s])
      if (sc.majminN && sc.majmin === 1) {
        found = Math.max(0, s.startMs - c.startMs)
        break
      }
    }
    if (found === null) continue
    n++
    delays.push(found)
    if (found <= beat) within++
  }
  delays.sort((a, b) => a - b)
  return { median: delays[delays.length >> 1] ?? NaN, within: n ? within / n : 0 }
}

function pct(x: number): string {
  return (x * 100).toFixed(1).padStart(5) + '%'
}
