// Fetches an analysed timeline from the Worker store (M3, D-32). M5 adds the IndexedDB cache and the screens.
import { Timeline } from '@mq/model'
import { API_URL } from '../config'

export type TimelineResult =
  | { status: 'ok'; timeline: Timeline; bytes: number; ms: number }
  | { status: 'missing' }
  | { status: 'error'; message: string }

export async function fetchTimeline(spotifyTrackId: string, f: typeof fetch = fetch): Promise<TimelineResult> {
  const t0 = performance.now()
  try {
    const res = await f(`${API_URL}/timelines/spotify:track:${spotifyTrackId}`)
    if (res.status === 404) return { status: 'missing' }
    if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` }
    const text = await res.text()
    const parsed = Timeline.safeParse(JSON.parse(text))
    if (!parsed.success) return { status: 'error', message: `invalid timeline: ${parsed.error.issues[0]?.message}` }
    return { status: 'ok', timeline: parsed.data, bytes: text.length, ms: performance.now() - t0 }
  } catch (e) {
    return { status: 'error', message: String(e) }
  }
}

/** The chord sounding at `positionMs`, or null. */
export function chordAt(tl: Timeline, positionMs: number): Timeline['chords'][number] | null {
  let lo = 0
  let hi = tl.chords.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const c = tl.chords[mid]!
    if (positionMs < c.startMs) hi = mid - 1
    else if (positionMs >= c.endMs) lo = mid + 1
    else return c
  }
  return null
}
