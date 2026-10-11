// SP7 on the PC: scores the live timelines the phone uploaded (PUT /api/live/:id) for the truth songs against their
// human annotations (D-39), per beat, MIREX rules. Each stretch of listening (split where nothing was saved for
// > 5 s) is scored as saved and at the time shift that scores best (±5 s): a constant mic/stamping offset shows there.
//   pnpm --filter @mq/listen score-live [--api https://…/api]
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { bestShift } from '../src/offset'
import { scoreBeats, type Span } from '../src/score'

const REPO = join(import.meta.dirname, '..', '..', '..')
const TRUTH = join(REPO, 'companion', 'truth')
const args = process.argv.slice(2)
const i = args.indexOf('--api')
const API = i >= 0 ? args[i + 1]! : 'https://musicqueery.ethangruening.workers.dev/api'
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

const seen = new Set<string>()
let found = 0
for (const f of readdirSync(TRUTH).filter((x) => x.endsWith('.timeline.json'))) {
  const name = f.replace('.timeline.json', '')
  const rec = JSON.parse(readFileSync(join(TRUTH, `${name}.json`), 'utf8')) as { trackId: string; title: string; annotation?: unknown }
  // human annotations only (iReal-chart truths are secondary, D-39), one per track
  if (!rec.annotation || seen.has(rec.trackId)) continue
  seen.add(rec.trackId)
  const tl = JSON.parse(readFileSync(join(TRUTH, f), 'utf8')) as { beats: number[]; chords: Span[] }
  const res = await fetch(`${API}/live/spotify:track:${rec.trackId}`)
  if (!res.ok) continue
  found++
  const live = (await res.json()) as { chords: Span[]; createdAt: string }
  const at = (cs: Span[], shift: number) => {
    const a = cs[0]!.startMs + shift
    const b = cs[cs.length - 1]!.endMs + shift
    const moved = cs.map((c) => ({ ...c, startMs: c.startMs + shift, endMs: c.endMs + shift }))
    return scoreBeats(tl.chords, tl.beats.filter((t) => t >= a && t <= b), moved)
  }
  // stretches of listening
  const parts: Span[][] = []
  for (const c of live.chords) {
    const last = parts[parts.length - 1]
    if (last && c.startMs - last[last.length - 1]!.endMs <= 5000) last.push(c)
    else parts.push([c])
  }
  console.log(`${rec.title} · saved ${live.createdAt}`)
  for (const cs of parts) {
    if (cs.length < 3) continue
    const s0 = at(cs, 0)
    const b = bestShift(tl.chords, tl.beats, cs)
    const best = { shift: b?.shiftMs ?? 0, ...at(cs, b?.shiftMs ?? 0) }
    const span = `${(cs[0]!.startMs / 1000).toFixed(0)}–${(cs[cs.length - 1]!.endMs / 1000).toFixed(0)} s`
    console.log(
      `  ${span.padEnd(11)} ${String(s0.beats).padStart(3)} beats · as saved majmin ${pct(s0.majmin)} · ` +
        `best shift ${best.shift} ms → majmin ${pct(best.majmin)} sevenths ${pct(best.sevenths)}` +
        (b ? ` (next best ${pct(b.runnerUp)})` : ''),
    )
  }
}
if (!found) console.log('No live timelines for the truth songs yet. Play one on a speaker with the Mic test (SP7) running.')
