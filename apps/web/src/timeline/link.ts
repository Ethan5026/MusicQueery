// A chart linked to a recording (M7): an imported iReal chart (or a built-in tune) laid over the track's timeline by
// `alignChart` (Jump Alignment), so its chord names and rehearsal marks replace the recogniser's where it fits.
// The link is kept per track (IndexedDB settings `link:<id>`) and re-applied whenever the track opens; it is only
// used when the alignment trusts the chart (roots agree, few jumps), so a wrong pick is refused, not shown.
// M12: the companion sends the iReal charts titled like the track inside the timeline (`charts`), and the phone links
// the best one that fits by itself, once per analysis; when the player unlinks, that sticks. Only charts from iReal's
// jazz-side lists link by themselves: on the human-annotated pop songs a Pop 400 chart scored below what was heard
// (Something, Just the Way You Are), so pop charts are only offered in the sheet (D-36).
import type { Chart, Timeline } from '@mq/model'
import { type AlignResult, alignChart } from '@mq/listen'
import { songKey } from '@mq/theory'
import { TUNES, chartIndex, importedChart } from '../audio/library'
import { log } from '../debug/log'
import { idbDelete, idbGet, idbSet } from '../store/idb'

export interface ChartLink {
  /** `tune:<id>`, an imported chart id, `tl:<chart id>` (a chart that came with the timeline, M12), or `none` */
  ref: string
  title: string
  at: string
  /** linked by the phone itself (M12). With ref `none`: no chart fitted the analysis made at `for` (tried again when
   *  the track is analysed anew); without `auto`, `none` means the player unlinked */
  auto?: boolean
  for?: string
}

/** Stored when the player unlinks: no automatic link for this track from then on. */
export const UNLINKED = (): ChartLink => ({ ref: 'none', title: '', at: new Date().toISOString() })

const key = (id: string) => `link:${id}`

export const loadLink = async (id: string): Promise<ChartLink | null> => (await idbGet<ChartLink>('settings', key(id))) ?? null

export async function saveLink(id: string, link: ChartLink | null): Promise<void> {
  if (link) await idbSet('settings', key(id), link)
  else await idbDelete('settings', key(id))
  log('info', 'link.set', { id, ref: link?.ref ?? null })
}

export async function chartByRef(ref: string, tl?: Timeline): Promise<Chart | null> {
  if (ref === 'none') return null
  if (ref.startsWith('tune:')) return TUNES.find((t) => t.id === ref.slice(5)) ?? null
  if (ref.startsWith('tl:')) return tl?.charts?.find((c) => c.id === ref.slice(3)) ?? null
  return importedChart(ref)
}

function aligned(tl: Timeline, chart: Chart, ref: string): AlignResult {
  const t0 = performance.now()
  const r = alignChart(chart, tl)
  log('info', 'link.align', {
    id: tl.id,
    ref,
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

/** The chart aligned to `tl`, with what the alignment found. */
export async function alignLinked(tl: Timeline, link: ChartLink): Promise<AlignResult | null> {
  const chart = await chartByRef(link.ref, tl)
  return chart ? aligned(tl, chart, link.ref) : null
}

/** iReal playlists whose charts may link by themselves: Jazz 1460, Brazilian 220, Latin 50, Blues 50. */
export const autoLinks = (playlist: string | undefined): boolean => /^(jazz|brazilian|latin|blues)\b/i.test(playlist ?? '')

/** Charts the phone may link by itself: those that came with the timeline, then imported ones with the same title,
 *  from the jazz-side lists only. */
export async function linkCandidates(tl: Timeline, title: string | null): Promise<Array<{ ref: string; chart: Chart }>> {
  const out = (tl.charts ?? []).filter((c) => autoLinks(c.source?.playlist)).map((chart) => ({ ref: `tl:${chart.id}`, chart }))
  if (!title) return out
  const want = songKey(title)
  for (const e of await chartIndex()) {
    if (out.length >= 6 || !autoLinks(e.playlist) || songKey(e.title) !== want || out.some((x) => x.chart.id === e.id)) continue
    const chart = await importedChart(e.id)
    if (chart) out.push({ ref: e.id, chart })
  }
  return out
}

/** M12: lines up every candidate and returns the link to the best one the alignment trusts (null when none fits). */
export async function autoLink(tl: Timeline, title: string | null): Promise<{ link: ChartLink; timeline: Timeline } | null> {
  let best: { ref: string; chart: Chart; r: AlignResult; score: number } | null = null
  for (const { ref, chart } of await linkCandidates(tl, title)) {
    const r = aligned(tl, chart, ref)
    const score = r.agreement * r.matched
    if (r.timeline && (!best || score > best.score)) best = { ref, chart, r, score }
  }
  if (!best) return null
  return { link: { ref: best.ref, title: best.chart.title, at: new Date().toISOString(), auto: true }, timeline: best.r.timeline! }
}
