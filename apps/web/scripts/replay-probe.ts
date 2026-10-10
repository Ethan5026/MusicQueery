// Replays an uploaded drift-probe report through the current SpotifyClock and DriftAnalyzer,
// using its raw Spotify samples and mic onsets, so clock or analysis changes can be checked
// against real device data.
//
//   wrangler kv key get <report key> --namespace-id <id> --remote > report.json
//   node apps/web/scripts/replay-probe.ts report.json [--tolerance 150]

import { readFileSync } from 'node:fs'
import { SpotifyClock, type PlayerSample } from '../src/clock/SpotifyClock.ts'
import { DriftAnalyzer } from '../src/probe/analysis.ts'

interface Report {
  startedPerf: number
  options: { bpm: number; toleranceMs: number }
  samples: PlayerSample[]
  onsets: { at: number; level: number }[]
}

const [file, ...rest] = process.argv.slice(2)
if (!file) throw new Error('usage: replay-probe.ts report.json [--tolerance ms]')
const r = JSON.parse(readFileSync(file, 'utf8')) as Report
const tolIdx = rest.indexOf('--tolerance')
const tol = tolIdx >= 0 ? Number(rest[tolIdx + 1]) : r.options.toleranceMs

const clock = new SpotifyClock({ fetchPlayer: async () => r.samples[0] as PlayerSample })
const analyzer = new DriftAnalyzer({ periodMs: 60_000 / r.options.bpm, toleranceMs: tol })
const t0 = r.startedPerf
const sec = (at: number) => ((at - t0) / 1000).toFixed(1)

clock.onJump((j) => {
  analyzer.addJump(j.kind, j.at)
  console.log(`jump ${j.kind.padEnd(6)} at ${sec(j.at).padStart(6)} s  ${Math.round(j.fromMs)} → ${j.toMs}`)
})

type Ev = { at: number; sample?: PlayerSample; onset?: { at: number; level: number } }
const events: Ev[] = [
  ...r.samples.map((s) => ({ at: s.t1, sample: s })),
  ...r.onsets.map((o) => ({ at: o.at, onset: o })),
].sort((a, b) => a.at - b.at)

for (const e of events) {
  if (e.sample) clock.ingest(e.sample)
  else if (e.onset && clock.locked) {
    analyzer.addOnset(e.onset, { trackId: clock.trackId, playing: clock.playing, posMs: clock.rawPositionMs(e.onset.at) })
  }
}

const s = analyzer.summary()
const f = (x: number | null, d = 1) => (x === null ? '–' : x.toFixed(d))
console.log(`\nmeasured ${s.points} clicks over ${(s.measuredForMs / 60_000).toFixed(1)} min (excluded ${s.excluded}, rejected ${s.rejected}/${s.onsets})`)
console.log(`|drift| median ${f(s.medianAbsMs)} ms · p95 ${f(s.p95AbsMs)} ms · max ${f(s.maxAbsMs)} ms · trend ${f(s.slopeMsPerMin, 2)} ms/min`)
console.log(`tempo check ${f(s.periodPpm, 0)} ppm · reference phase ${f(s.referencePhaseMs, 0)} ms`)
for (const st of s.steps) console.log(`step at ${sec(st.at)} s: ${st.sizeMs.toFixed(0)} ms`)
for (const e of s.episodes)
  console.log(`episode ${e.kind.padEnd(6)} at ${sec(e.firstBadAt).padStart(6)} s: re-lock ${e.relockMs.toFixed(0)} ms (≥ ${e.relockMinMs.toFixed(0)})`)
if (s.outOfLockSinceAt !== null) console.log(`still out of lock since ${sec(s.outOfLockSinceAt)} s`)
