// SP7 on the PC: scores the live timelines the phone uploaded (PUT /api/live/:id) for the truth songs against their
// human annotations (D-39), per beat, MIREX rules, and finds the time shift that scores best (±1 s): a constant
// mic/display offset shows up there.
//   pnpm --filter @mq/listen score-live [--api https://…/api]
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { scoreBeats, type Span } from '../src/score'

const REPO = join(import.meta.dirname, '..', '..', '..')
const TRUTH = join(REPO, 'companion', 'truth')
const args = process.argv.slice(2)
const i = args.indexOf('--api')
const API = i >= 0 ? args[i + 1]! : 'https://musicqueery.ethangruening.workers.dev/api'

let found = 0
for (const f of readdirSync(TRUTH).filter((x) => x.endsWith('.timeline.json'))) {
  const name = f.replace('.timeline.json', '')
  const rec = JSON.parse(readFileSync(join(TRUTH, `${name}.json`), 'utf8')) as { trackId: string; title: string }
  const tl = JSON.parse(readFileSync(join(TRUTH, f), 'utf8')) as { beats: number[]; chords: Span[] }
  const res = await fetch(`${API}/live/spotify:track:${rec.trackId}`)
  if (!res.ok) continue
  found++
  const live = (await res.json()) as { chords: Span[]; createdAt: string; durationMs: number }
  // only the beats the phone actually heard
  const a = live.chords[0]?.startMs ?? 0
  const b = live.chords[live.chords.length - 1]?.endMs ?? 0
  const beats = tl.beats.filter((t) => t >= a && t <= b)
  const at = (shift: number) =>
    scoreBeats(tl.chords, beats, live.chords.map((c) => ({ ...c, startMs: c.startMs + shift, endMs: c.endMs + shift })))
  const s0 = at(0)
  let best = { shift: 0, majmin: s0.majmin }
  for (let sh = -1000; sh <= 1000; sh += 20) {
    const s = at(sh)
    if (s.majmin > best.majmin) best = { shift: sh, majmin: s.majmin }
  }
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  console.log(
    `${rec.title.slice(0, 34).padEnd(34)} heard ${((b - a) / 1000).toFixed(0)} s (${s0.beats} beats) · root ${pct(s0.root)} majmin ${pct(s0.majmin)} sevenths ${pct(s0.sevenths)}` +
      ` · best shift ${best.shift} ms → majmin ${pct(best.majmin)} · ${live.createdAt}`,
  )
}
if (!found) console.log('No live timelines for the truth songs yet. Play one on a speaker with the Mic test (SP7) running.')
