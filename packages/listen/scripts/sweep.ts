// Parameter sweep for the decoder on cached frames (eval.ts reads the audio; this keeps it in memory).
//   pnpm --filter @mq/listen sweep [--room] [--grid '{"emission.bass":[2,3,4]}']
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_EMISSION, DEFAULT_TRANSITION, changePrior, emissions, viterbi } from '../src/chords'
import { keyWeights } from '../src/keys'
import { beatSync, frontendFrames, spans } from '../src/offline'
import { beatVectors, consensus, findRepeats } from '../src/repeats'
import { simulateRoom } from '../src/room'
import { scoreBeats, type Span } from '../src/score'

const REPO = join(import.meta.dirname, '..', '..', '..')
const TRUTH = join(REPO, 'companion', 'truth')
const AUDIO = join(process.env.LOCALAPPDATA ?? '', 'MusicQueery', 'work', 'truth')
const SR = 44100
const args = process.argv.slice(2)
const opt = (f: string) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}

function readAudio(name: string): Float32Array {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', join(AUDIO, `${name}.flac`), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], {
    maxBuffer: 1 << 30,
  })
  const b = r.stdout as Buffer
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice()
}

const songs = readdirSync(TRUTH)
  .filter((f) => f.endsWith('.timeline.json'))
  .map((f) => ({ name: f.replace('.timeline.json', ''), tl: JSON.parse(readFileSync(join(TRUTH, f), 'utf8')) as { beats: number[]; chords: Span[] } }))
  .filter((s) => s.tl.chords.some((c) => c.harte !== undefined))
  .map((s) => {
    let audio = readAudio(s.name)
    if (args.includes('--room')) audio = simulateRoom(audio, SR, { seed: s.name.length })
    const { frames } = frontendFrames(audio, SR)
    return { ...s, feats: beatSync(frames, s.tl.beats) }
  })

const grid: Record<string, number[]> = JSON.parse(opt('--grid') ?? '{}')
const keys = Object.keys(grid)
const combos: Record<string, number>[] = [{}]
for (const k of keys) {
  const next: Record<string, number>[] = []
  for (const c of combos) for (const v of grid[k]!) next.push({ ...c, [k]: v })
  combos.splice(0, combos.length, ...next)
}
const rows: { c: Record<string, number>; mm: number; sv: number; root: number }[] = []
for (const c of combos) {
  const ep = { ...DEFAULT_EMISSION }
  const tp = { ...DEFAULT_TRANSITION }
  let sharp = 12
  let keyPrior = true
  const rep = { window: 16, threshold: 0.8, self: 1.5, on: 0 }
  for (const [k, v] of Object.entries(c)) {
    const [g, f] = k.split('.')
    if (g === 'emission') (ep as Record<string, number>)[f!] = v
    else if (g === 'transition') (tp as Record<string, number>)[f!] = v
    else if (k === 'sharp') sharp = v
    else if (k === 'keyPrior') keyPrior = v > 0
    else if (g === 'repeat') (rep as Record<string, number>)[f!] = v
  }
  let mm = 0
  let sv = 0
  let root = 0
  const per: string[] = []
  for (const s of songs) {
    let ll = s.feats.map((f) => emissions(f, ep))
    if (rep.on) ll = consensus(ll, findRepeats(beatVectors(s.feats), { window: rep.window, threshold: rep.threshold }), rep.self)
    const total = new Float32Array(12)
    for (const f of s.feats) for (let p = 0; p < 12; p++) total[p]! += f.treble[p]!
    const prior = changePrior(keyWeights(total, sharp), tp)
    const path = viterbi(ll, keyPrior ? s.feats.map(() => prior) : null, tp)
    const sc = scoreBeats(s.tl.chords, s.tl.beats, spans(path, s.tl.beats))
    mm += sc.majmin / songs.length
    sv += sc.sevenths / songs.length
    root += sc.root / songs.length
    per.push((sc.majmin * 100).toFixed(0))
  }
  rows.push({ c, mm, sv, root })
  console.log(JSON.stringify(c), `root ${(root * 100).toFixed(1)} majmin ${(mm * 100).toFixed(1)} sevenths ${(sv * 100).toFixed(1)}  [${per.join(' ')}]`)
}
rows.sort((a, b) => b.mm + b.sv - a.mm - a.sv)
console.log('best', JSON.stringify(rows[0]))
