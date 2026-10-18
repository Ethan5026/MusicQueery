// Stress: every truth timeline on the PC (human-annotated pop and jazz, many with several chords a bar), the
// built-in tunes, the drills (Coltrane changes, all-12-keys ii–V–Is) and the demo, engraved for every
// instrument and Play mode and laid out at phone widths. Checks the invariants and prints how dense it gets.
import { DRILLS, TUNES } from '@mq/band'
import { Timeline } from '@mq/model'
import { DEMO_CHART, INSTRUMENT_IDS, chartTimeline, fromHarte } from '@mq/theory'
import { expect, test } from 'vitest'
import type { PlayMode } from './play'
import { engrave, layout } from './engrave'

const TRUTH = import.meta.glob<string>('../../../../../companion/truth/*.timeline.json', { query: '?raw', import: 'default', eager: true })

function corpus(): Array<[string, Timeline]> {
  const out: Array<[string, Timeline]> = []
  for (const [path, raw] of Object.entries(TRUTH)) {
    const json = JSON.parse(raw) as { chords: Array<{ symbol: string; harte?: string }> }
    // the human truths keep Harte labels: read them as the app's chord text
    for (const c of json.chords) c.symbol = (c.harte && fromHarte(c.harte)) || c.symbol
    const r = Timeline.safeParse(json)
    if (!r.success) continue
    const tl = r.data
    // annotation truths carry beats but no bars: bar them by the meter, as the analysis would
    if (!tl.bars.length) tl.bars = tl.beats.filter((_, i) => i % tl.meter.num === 0).map((startMs, i) => ({ startMs, number: i + 1 }))
    out.push([path.split('/').pop()!.replace('.timeline.json', ''), tl])
  }
  out.push(['demo', chartTimeline(DEMO_CHART)])
  for (const t of TUNES) out.push([t.id, chartTimeline(t)])
  for (const d of DRILLS) out.push([d.id, chartTimeline(d.build(d.key))])
  return out
}

const MODES: PlayMode[] = ['simple', 'integrated', 'advanced']
/** staff spaces across: portrait at s ≈ 11.5 (32), landscape (73) */
const WIDTHS = [32, 34, 73]

test('every song, instrument, mode and width engraves with sound geometry', () => {
  const rows: string[] = []
  for (const [name, tl] of corpus()) {
    let changes = 0
    let systems = 0
    let overflow = 0
    for (const inst of INSTRUMENT_IDS)
      for (const mode of MODES) {
        const sc = engrave(tl, inst, mode, 'inside')
        expect(sc.measures).toHaveLength(tl.bars.length)
        for (const m of sc.measures) {
          for (const r of m.runs) {
            expect(r.notes.length).toBeGreaterThanOrEqual(6)
            expect(r.blocks.length + (r.fresh ? 1 : 0)).toBeGreaterThanOrEqual(0)
            for (const n of r.notes) expect(Number.isFinite(n.p)).toBe(true)
            expect(r.to).toBeGreaterThan(r.from)
          }
          for (const b of m.bass) expect(b.stack.length).toBeGreaterThan(0)
        }
        for (const w of WIDTHS) {
          const { systems: ss, systemOf } = layout(sc, w)
          expect(systemOf.filter((x) => x !== undefined)).toHaveLength(tl.bars.length)
          for (const s of ss) {
            for (const p of s.placed) {
              expect(Number.isFinite(p.x1)).toBe(true)
              for (const sl of p.slots) expect(sl.x1).toBeGreaterThanOrEqual(sl.x0 - 1e-6)
            }
            if (s.width > w + 0.5) overflow++
            for (const p of s.placed) for (const sl of p.slots) if (sl.x1 > s.width + 0.5) overflow++
          }
          if (inst === 'alto' && mode === 'integrated' && w === 32) systems = ss.length
        }
        if (inst === 'concert' && mode === 'simple') changes = sc.measures.reduce((n, m) => n + m.chords.filter((c) => !c.held).length, 0)
      }
    rows.push(`${name.padEnd(40)} bars ${String(tl.bars.length).padStart(4)}  chords/bar ${(changes / tl.bars.length).toFixed(2)}  alto portrait: ${(tl.bars.length / systems).toFixed(2)} bars/line  overflowing lines ${overflow}`)
  }
  console.log(rows.join('\n'))
})
