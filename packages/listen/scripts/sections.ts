// P-05 check: section boundaries from chord repetition against the human segment annotations in ChoCo's JAMS
// (Isophonics / Billboard `segment_open`, shifted onto the Spotify release like the chords, D-39). Scores the
// truth chords (the ceiling for harmony-only sections) and the live decoder's chords on the same audio.
//   pnpm --filter @mq/listen sections
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Timeline } from '@mq/model'
import { fromHarte } from '@mq/theory'
import { LiveDecoder } from '../src/live'
import { boundaryF, findSections } from '../src/sections'
import { liveTimeline } from '../src/timeline'

const REPO = join(import.meta.dirname, '..', '..', '..')
const TRUTH = join(REPO, 'companion', 'truth')
const LOCAL = join(process.env.LOCALAPPDATA ?? '', 'MusicQueery')
const SR = 22050

const rows: { truth: number; live: number; pc: number }[] = []
for (const f of readdirSync(TRUTH).filter((x) => x.endsWith('.timeline.json'))) {
  const name = f.replace('.timeline.json', '')
  const rec = JSON.parse(readFileSync(join(TRUTH, `${name}.json`), 'utf8')) as { trackId: string; annotation?: { jams: string; shiftMs: number } }
  if (!rec.annotation) continue
  const jams = JSON.parse(readFileSync(join(LOCAL, 'dl', 'choco', 'jams', rec.annotation.jams), 'utf8')) as {
    annotations: { namespace: string; data: { time: number; duration: number; value: string }[] }[]
  }
  const seg = jams.annotations.find((a) => a.namespace === 'segment_open')
  if (!seg) continue
  const ref = seg.data.map((d) => d.time * 1000 + rec.annotation!.shiftMs)
  const tl = JSON.parse(readFileSync(join(TRUTH, f), 'utf8')) as Timeline
  // truth chords are Harte labels; rebuild the timeline so bar lines go where its chords change most
  const truthTl = liveTimeline({
    id: tl.id,
    durationMs: tl.durationMs,
    chords: tl.chords.map((c) => ({ ...c, symbol: fromHarte((c as { harte?: string }).harte ?? c.symbol) ?? 'N.C.' })),
    beats: tl.beats,
    createdAt: tl.createdAt,
  })
  const est = findSections(truthTl).map((s) => s.startMs)
  // the live decoder on the same recording
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', join(LOCAL, 'work', 'truth', `${name}.flac`), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
  const b = r.stdout as Buffer
  const audio = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice()
  const dec = new LiveDecoder({ sampleRate: SR })
  for (let i = 0; i < audio.length; i += 4096) dec.push(audio.subarray(i, i + 4096))
  const fin = dec.finish()
  const live = liveTimeline({
    id: 'spotify:track:0000000000000000000000',
    durationMs: (audio.length / SR) * 1000,
    chords: fin.chords.map((c) => ({ startMs: c.start * 1000, endMs: c.end * 1000, symbol: c.symbol })),
    beats: fin.beats.map((x) => x * 1000),
    createdAt: new Date().toISOString(),
  })
  const liveSec = findSections(live)
  const fT = boundaryF(ref, est)
  const fL = boundaryF(ref, liveSec.map((s) => s.startMs))
  // the PC's analysis of the track, from the store
  const res = await fetch(`https://musicqueery.ethangruening.workers.dev/api/timelines/spotify:track:${rec.trackId}`)
  const pcTl = res.ok ? ((await res.json()) as Timeline) : null
  const pcSec = pcTl ? findSections({ ...pcTl, edits: [] }) : []
  const fP = pcTl ? boundaryF(ref, pcSec.map((s) => s.startMs)) : NaN
  rows.push({ truth: fT, live: fL, pc: fP })
  console.log(
    `${name.padEnd(36)} ref ${String(ref.length).padStart(2)} · truth chords ${String(est.length).padStart(2)} F ${fT.toFixed(2)} · live ${String(liveSec.length).padStart(2)} F ${fL.toFixed(2)} · PC ${String(pcSec.length).padStart(2)} F ${fP.toFixed(2)} ${pcSec.map((s) => s.label).join('')}`,
  )
}
const m = (k: 'truth' | 'live' | 'pc') => rows.reduce((a, r) => a + r[k], 0) / Math.max(1, rows.length)
console.log(`MEAN boundary F@3s: truth chords ${m('truth').toFixed(2)}, live ${m('live').toFixed(2)}, PC analysis ${m('pc').toFixed(2)}`)
