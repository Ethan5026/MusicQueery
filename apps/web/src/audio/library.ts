// What the band can play (D-12): built-in tunes, drills, and charts imported from iReal Pro playlists. Imports are
// stored in IndexedDB `charts` as chunks of 100 charts per record (WebKit pays per record: 1460 puts took 23 s in
// Playwright's WebKit, 15 chunks 0.5 s), with a small index in `settings/chartIndex` naming each chart's chunk, so a
// 1300-tune list opens and searches without reading any chart.
// A BandSpec names one of them plus the user's key, tempo, style and choruses; it is all a session needs to rebuild
// the chart, so it is what gets saved.
import { type BandStyle, DRILLS, STYLE_BPM, STYLE_LABEL, TUNES, drillById, styleFor } from '@mq/band'
import type { Chart } from '@mq/model'
import { type ImportResult, importPlaylist, transposeChart } from '@mq/theory'
import { log } from '../debug/log'
import { idbDeleteMany, idbGet, idbPutMany, idbSet } from '../store/idb'

export type BandKind = 'tune' | 'drill' | 'ireal'

export interface BandSpec {
  kind: BandKind
  /** tune id, drill id or imported chart id */
  ref: string
  /** concert tonic the user picked */
  key: string
  mode: 'major' | 'minor'
  bpm: number
  style: BandStyle
  choruses: number
}

export interface ChartEntry {
  id: string
  title: string
  composer?: string
  style?: string
  key: string
  mode: 'major' | 'minor'
  bars: number
  playlist: string
  /** `charts` record holding it */
  chunk: string
}

const CHUNK = 100

const INDEX_KEY = 'chartIndex'

export async function chartIndex(): Promise<ChartEntry[]> {
  return (await idbGet<ChartEntry[]>('settings', INDEX_KEY)) ?? []
}

const entryOf = (c: Chart, playlist: string, chunk: string): ChartEntry => ({
  id: c.id,
  title: c.title,
  ...(c.composer ? { composer: c.composer } : {}),
  ...(c.style ? { style: c.style } : {}),
  key: c.key.tonic,
  mode: c.key.mode,
  bars: c.bars.length,
  playlist,
  chunk,
})

export interface ImportSummary {
  name: string
  added: number
  replaced: number
  /** songs with anything the parser didn't understand (still imported; issues stay on the chart) */
  withIssues: number
  failed: number
  ms: number
}

/** Imports an irealb:// playlist (link, HTML page or text). Songs already imported (same id) are replaced. */
export async function importIreal(text: string, fallbackName = 'Imported'): Promise<ImportSummary> {
  const t0 = performance.now()
  const { name, results } = importPlaylist(text)
  if (results.length === 0) throw new Error('No iReal Pro songs found in that.')
  const playlist = name ?? fallbackName
  const ok: ImportResult[] = results.filter((r) => r.chart.bars.length > 0)
  const index = await chartIndex()
  const have = new Set(index.map((e) => e.id))
  const replaced = ok.filter((r) => have.has(r.chart.id)).length
  // a re-import replaces the playlist's chunks
  const stamp = Date.now().toString(36)
  const chunks: Array<[string, Chart[]]> = []
  for (let i = 0; i < ok.length; i += CHUNK) chunks.push([`${playlist}#${stamp}#${i / CHUNK}`, ok.slice(i, i + CHUNK).map((r) => r.chart)])
  const saved = await idbPutMany('charts', chunks)
  if (!saved) throw new Error('Couldn’t save the charts on this phone (storage full or blocked).')
  await idbDeleteMany('charts', [...new Set(index.filter((e) => e.playlist === playlist).map((e) => e.chunk))])
  const fresh = new Map(chunks.flatMap(([key, cs]) => cs.map((c) => [c.id, entryOf(c, playlist, key)] as const)))
  const next = [...index.filter((e) => !fresh.has(e.id)), ...fresh.values()]
  await idbSet('settings', INDEX_KEY, next)
  const summary: ImportSummary = {
    name: playlist,
    added: ok.length - replaced,
    replaced,
    withIssues: ok.filter((r) => r.issues.length > 0).length,
    failed: results.length - ok.length,
    ms: Math.round(performance.now() - t0),
  }
  log('info', 'ireal.import', { ...summary })
  return summary
}

/** Removes every chart imported from `playlist`. */
export async function removePlaylist(playlist: string): Promise<void> {
  const index = await chartIndex()
  await idbDeleteMany('charts', [...new Set(index.filter((e) => e.playlist === playlist).map((e) => e.chunk))])
  await idbSet('settings', INDEX_KEY, index.filter((e) => e.playlist !== playlist))
}

/** The chart a spec plays, in the spec's key; null if it's gone (an imported chart removed since). */
export async function chartFor(spec: BandSpec): Promise<Chart | null> {
  if (spec.kind === 'drill') {
    const d = drillById(spec.ref)
    return d ? d.build(spec.key) : null
  }
  const base = spec.kind === 'tune' ? (TUNES.find((t) => t.id === spec.ref) ?? null) : await importedChart(spec.ref)
  if (!base) return null
  return base.key.tonic === spec.key ? base : transposeChart(base, spec.key)
}

/** The spec a chart starts with: its own key, tempo (or the style's), style and choruses. */
export function defaultSpec(kind: BandKind, chart: Chart): BandSpec {
  const style = styleFor(chart.style, chart.meter.num)
  return {
    kind,
    ref: chart.id,
    key: chart.key.tonic,
    mode: chart.key.mode,
    bpm: Math.round(chart.tempo ?? STYLE_BPM[style]),
    style,
    choruses: kind === 'drill' ? (chart.choruses ?? 1) : Math.min(chart.choruses ?? 3, 12),
  }
}

export function drillSpec(id: string): BandSpec | null {
  const d = drillById(id)
  if (!d) return null
  const chart = d.build(d.key)
  return { ...defaultSpec('drill', chart), ref: d.id, key: d.key }
}

/** "Medium Swing · 140 BPM" style line under a band track's title. */
export const specLine = (spec: BandSpec): string => `${STYLE_LABEL[spec.style]} · ${spec.bpm} BPM`

export { DRILLS, TUNES }

/** An imported chart by id (one chunk read). */
export async function importedChart(id: string): Promise<Chart | null> {
  const e = (await chartIndex()).find((x) => x.id === id)
  if (!e) return null
  return (await idbGet<Chart[]>('charts', e.chunk))?.find((c) => c.id === id) ?? null
}
