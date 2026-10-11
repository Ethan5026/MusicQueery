// Chord fixes (M7, Timeline v1 `edits[]`): the player's corrections, kept per track apart from the timeline itself
// (IndexedDB `edits`, and the store's `/api/edits/:id` so they survive a reinstall), so a re-analysis or a new listen
// keeps them: they apply by time span over whatever timeline is shown (`effectiveChords`, later fixes win).
import { type Timeline, type TimelineEdit, TimelineEdits } from '@mq/model'
import { API_URL } from '../config'
import { log } from '../debug/log'
import { accessToken } from '../spotify/auth'
import { idbGet, idbSet } from '../store/idb'

export type Edit = TimelineEdit

/** Fixes for `id`: IndexedDB, else the store (once, then cached). */
export async function loadEdits(id: string): Promise<Edit[]> {
  const cached = await idbGet<Edit[]>('edits', id)
  if (cached) return cached
  if (!id.startsWith('spotify:track:') || !navigator.onLine) return []
  try {
    const res = await fetch(`${API_URL}/edits/${id}`, { cache: 'no-store' })
    if (!res.ok) return []
    const parsed = TimelineEdits.safeParse(((await res.json()) as { edits?: unknown }).edits)
    if (!parsed.success) return []
    await idbSet('edits', id, parsed.data)
    return parsed.data
  } catch {
    return []
  }
}

export async function saveEdits(id: string, edits: Edit[]): Promise<void> {
  await idbSet('edits', id, edits)
  if (!id.startsWith('spotify:track:')) return
  try {
    const token = await accessToken()
    if (!token) return
    const res = await fetch(`${API_URL}/edits/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Spotify-Token': token },
      body: JSON.stringify({ edits }),
    })
    log(res.ok ? 'info' : 'warn', 'edits.upload', { id, status: res.status, n: edits.length })
  } catch (err) {
    log('warn', 'edits.upload', { id, err: String(err) })
  }
}

/** The timeline with the track's fixes on top of any it already carries. Same object when there are none. */
export function withEdits(tl: Timeline, edits: Edit[]): Timeline {
  if (!edits.length) return tl
  return { ...tl, edits: [...tl.edits, ...edits] }
}

/** A fix over [startMs, endMs) to `symbol`; `prev` is what was shown. */
export function makeEdit(startMs: number, endMs: number, symbol: string, prev?: string): Edit {
  return { at: new Date().toISOString(), startMs: Math.round(startMs), endMs: Math.round(endMs), symbol, ...(prev ? { prev } : {}) }
}
