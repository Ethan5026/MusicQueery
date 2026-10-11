// Recorded timelines the phone can open without Spotify playing (M4, ManualClock): the demo chart, built on
// the device, and analysed timelines from the store, cached in IndexedDB so they open offline.
import type { Timeline } from '@mq/model'
import { DEMO_CHART, chartTimeline } from '@mq/theory'
import { log } from '../debug/log'
import { fetchTrack } from '../spotify/api'
import { idbGet, idbKeys, idbSet } from '../store/idb'
import { fetchTimelineById } from './fetch'

export interface TrackMeta {
  id: string
  title: string
  artist?: string
  /** Chart style, e.g. "Medium Swing" (charts only) */
  style?: string
}

export const DEMO_ID = `chart:${DEMO_CHART.id}`
export const LET_IT_BE = 'spotify:track:7iN1s7xHE4ifF5povM6A48'

/** Always listed in Tracks → Recorded. */
export const SEEDS: TrackMeta[] = [
  { id: DEMO_ID, title: DEMO_CHART.title, artist: `${DEMO_CHART.composer} · demo chart`, ...(DEMO_CHART.style ? { style: DEMO_CHART.style } : {}) },
  { id: LET_IT_BE, title: 'Let It Be', artist: 'The Beatles' },
]

let demo: Timeline | null = null
export function demoTimeline(): Timeline {
  demo ??= chartTimeline(DEMO_CHART, { createdAt: '2026-10-11T00:00:00.000Z' })
  return demo
}

/** `spotify:track:<id>` from a Spotify link, URI or bare 22-character ID; null if it isn't one. */
export function parseTrackRef(s: string): string | null {
  const m = s.trim().match(/(?:track[/:])?([A-Za-z0-9]{22})(?:[?#].*)?$/)
  return m ? `spotify:track:${m[1]}` : null
}

export type LoadResult =
  | { status: 'ok'; timeline: Timeline; from: 'device' | 'cache' | 'store' }
  | { status: 'missing' }
  | { status: 'error'; message: string }

export async function loadTimeline(id: string): Promise<LoadResult> {
  if (id === DEMO_ID) return { status: 'ok', timeline: demoTimeline(), from: 'device' }
  const cached = await idbGet<Timeline>('timelines', id)
  if (cached) return { status: 'ok', timeline: cached, from: 'cache' }
  const r = await fetchTimelineById(id)
  log('info', 'timeline.fetch', {
    id,
    status: r.status,
    ...(r.status === 'ok' ? { chords: r.timeline.chords.length, bytes: r.bytes, ms: Math.round(r.ms) } : {}),
    ...(r.status === 'error' ? { err: r.message } : {}),
  })
  if (r.status !== 'ok') return r
  await idbSet('timelines', id, r.timeline)
  return { status: 'ok', timeline: r.timeline, from: 'store' }
}

/** Fetches `id` from the store; if it differs from `cached` (re-analysed on the PC), caches and returns it. */
export async function revalidate(id: string, cached: Timeline): Promise<Timeline | null> {
  const r = await fetchTimelineById(id)
  if (r.status !== 'ok') return null
  const t = r.timeline
  if (t.createdAt === cached.createdAt && t.chords.length === cached.chords.length && t.generator === cached.generator) return null
  await idbSet('timelines', id, t)
  return t
}

/** Title and artist: IndexedDB, then Spotify (when logged in), then the seeds, then the bare ID. */
export async function trackMeta(id: string): Promise<TrackMeta> {
  const seed = SEEDS.find((s) => s.id === id)
  if (id === DEMO_ID && seed) return seed
  const cached = await idbGet<TrackMeta>('tracks', id)
  if (cached) return cached
  const sid = id.startsWith('spotify:track:') ? id.slice('spotify:track:'.length) : null
  if (sid) {
    try {
      const t = await fetchTrack(sid)
      if (t) {
        const meta: TrackMeta = { id, title: t.title, artist: t.artist }
        await idbSet('tracks', id, meta)
        return meta
      }
    } catch {
      // not logged in or offline
    }
  }
  return seed ?? { id, title: sid ? `Track ${sid.slice(0, 6)}…` : id }
}

/** Seeds first, then every other cached timeline. */
export async function recordedList(): Promise<TrackMeta[]> {
  const ids = (await idbKeys('timelines')).filter((k) => !SEEDS.some((s) => s.id === k))
  return [...SEEDS, ...(await Promise.all(ids.map(trackMeta)))]
}

export const isCached = async (id: string): Promise<boolean> =>
  id === DEMO_ID || (await idbGet('timelines', id)) !== undefined
