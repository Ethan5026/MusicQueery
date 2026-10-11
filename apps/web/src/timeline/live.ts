// Live timelines (M7, D-09): what the phone heard through the mic, saved per Spotify track so the next play has
// chords and look-ahead before the PC has analysed it. Kept apart from analysed timelines everywhere, so a listen
// never replaces an analysis: IndexedDB key `live:<id>`, store `PUT /api/live/:id` (authorised by the phone's
// Spotify token like the analysis queue, D-46), and an analysed timeline always wins when both exist.
import { Timeline } from '@mq/model'
import { mergeLive } from '@mq/listen'
import { API_URL } from '../config'
import { log } from '../debug/log'
import { accessToken } from '../spotify/auth'
import { idbGet, idbSet } from '../store/idb'

export const LIVE_PREFIX = 'live:'
export const liveKey = (id: string): string => LIVE_PREFIX + id

/** The saved live timeline for `id`: IndexedDB, then the store. */
export async function loadLive(id: string, f: typeof fetch = fetch): Promise<Timeline | null> {
  const cached = await idbGet<Timeline>('timelines', liveKey(id))
  if (cached) return cached
  if (!id.startsWith('spotify:track:') || !navigator.onLine) return null
  try {
    const res = await f(`${API_URL}/live/${id}`, { cache: 'no-store' })
    if (!res.ok) return null
    const parsed = Timeline.safeParse(await res.json())
    if (!parsed.success) return null
    await idbSet('timelines', liveKey(id), parsed.data)
    return parsed.data
  } catch {
    return null
  }
}

/** Lays a finished segment over what was heard before, saves it, and uploads it. Returns the saved timeline. */
export async function saveLive(segment: Timeline): Promise<Timeline> {
  const prev = (await idbGet<Timeline>('timelines', liveKey(segment.id))) ?? null
  const merged = mergeLive(prev, segment)
  await idbSet('timelines', liveKey(segment.id), merged)
  void uploadLive(merged)
  return merged
}

export async function uploadLive(tl: Timeline): Promise<void> {
  try {
    const token = await accessToken()
    if (!token) return
    const res = await fetch(`${API_URL}/live/${tl.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Spotify-Token': token },
      body: JSON.stringify(tl),
    })
    log(res.ok ? 'info' : 'warn', 'live.upload', { id: tl.id, status: res.status, chords: tl.chords.length })
  } catch (err) {
    log('warn', 'live.upload', { id: tl.id, err: String(err) })
  }
}
