// JSON bridge from the Python companion (M3) into @mq/theory, so chord spelling, keys and charts come from one
// implementation. Bundled by `pnpm --filter @mq/theory bridge` into dist/bridge.mjs (Node can't run the
// extensionless TS imports directly). Reads one JSON request on stdin, writes one JSON reply on stdout:
//   {op:'finish', chords:[{startMs,endMs,symbol,confidence?}], beats:[ms], harte?, sevenths?} → FinishedAnalysis
//   {op:'harte', symbols:[...]}                → {harte:[...]}  (null where a symbol does not parse)
//   {op:'chart', playlist:path, title, transpose?:tonic} → {chart, played:PlayedBar[], issues}
//   {op:'titles', playlist:path}               → {titles:[...]}
import { readFileSync } from 'node:fs'
import { expandChart, finishAnalysis, importPlaylist, parseChord, toHarte, transposeChart } from '../src/index'

type Req =
  | { op: 'finish'; chords: Parameters<typeof finishAnalysis>[0]; beats: number[]; harte?: boolean; sevenths?: boolean }
  | { op: 'harte'; symbols: string[] }
  | { op: 'chart'; playlist: string; title: string; transpose?: string }
  | { op: 'titles'; playlist: string }

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the |, the$/, '')
    .trim()

function handle(req: Req): unknown {
  switch (req.op) {
    case 'finish':
      return finishAnalysis(req.chords, req.beats, { harte: req.harte ?? false, sevenths: req.sevenths ?? false })
    case 'harte':
      return {
        harte: req.symbols.map((s) => {
          const c = parseChord(s)
          return c ? toHarte(c) : null
        }),
      }
    case 'titles':
      return { titles: importPlaylist(readFileSync(req.playlist, 'utf8')).results.map((r) => r.chart.title) }
    case 'chart': {
      const { results } = importPlaylist(readFileSync(req.playlist, 'utf8'))
      const want = norm(req.title)
      const hit = results.find((r) => norm(r.chart.title) === want) ?? results.find((r) => norm(r.chart.title).startsWith(want))
      if (!hit) throw new Error(`no chart titled ${req.title}`)
      const chart = req.transpose ? transposeChart(hit.chart, req.transpose) : hit.chart
      return { chart, played: expandChart(chart), issues: hit.issues }
    }
  }
}

const input = readFileSync(0, 'utf8')
try {
  process.stdout.write(JSON.stringify(handle(JSON.parse(input) as Req)))
} catch (e) {
  process.stdout.write(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }))
  process.exitCode = 1
}
