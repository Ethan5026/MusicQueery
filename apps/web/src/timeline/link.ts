// A chart linked to a recording (M7): an imported iReal chart (or a built-in tune) laid over the track's timeline by
// `alignChart` (Jump Alignment), so its chord names and rehearsal marks replace the recogniser's where it fits.
// The link is kept per track (IndexedDB settings `link:<id>`) and re-applied whenever the track opens; it is only
// used when the alignment trusts the chart (roots agree, few jumps), so a wrong pick is refused, not shown.
import type { Chart, Timeline } from '@mq/model'
import { type AlignResult, alignChart } from '@mq/listen'
import { TUNES, importedChart } from '../audio/library'
import { log } from '../debug/log'
import { idbDelete, idbGet, idbSet } from '../store/idb'

export interface ChartLink {
  /** `tune:<id>` or an imported chart id */
  ref: string
  title: string
  at: string
}

const key = (id: string) => `link:${id}`

export const loadLink = async (id: string): Promise<ChartLink | null> => (await idbGet<ChartLink>('settings', key(id))) ?? null

export async function saveLink(id: string, link: ChartLink | null): Promise<void> {
  if (link) await idbSet('settings', key(id), link)
  else await idbDelete('settings', key(id))
  log('info', 'link.set', { id, ref: link?.ref ?? null })
}

export async function chartByRef(ref: string): Promise<Chart | null> {
  if (ref.startsWith('tune:')) return TUNES.find((t) => t.id === ref.slice(5)) ?? null
  return importedChart(ref)
}

/** The chart aligned to `tl`, with what the alignment found. */
export async function alignLinked(tl: Timeline, link: ChartLink): Promise<AlignResult | null> {
  const chart = await chartByRef(link.ref)
  if (!chart) return null
  const t0 = performance.now()
  const r = alignChart(chart, tl)
  log('info', 'link.align', {
    id: tl.id,
    ref: link.ref,
    ok: r.timeline !== null,
    semis: r.semis,
    ratio: r.ratio,
    matched: Math.round(r.matched * 100) / 100,
    agreement: Math.round(r.agreement * 100) / 100,
    jumpRate: Math.round(r.jumpRate * 100) / 100,
    ms: Math.round(performance.now() - t0),
  })
  return r
}
