// The playlist inbox (M5b): a Spotify playlist where adding a song queues it for analysis on the PC. The companion
// mirrors the playlist to the Worker after each change; the phone reads that mirror (GET /api/inbox) with each song's
// state, so it never reads playlists from Spotify itself (D-35) and needs no extra Spotify scope.
// The last answer is kept in IndexedDB so the list still shows offline.
import { API_URL } from '../config'
import { log } from '../debug/log'
import { idbGet, idbSet } from '../store/idb'
import type { TrackMeta } from './library'

export type InboxState = 'analysed' | 'queued' | 'working' | 'failed' | 'new'

export interface InboxSong {
  id: string
  title?: string
  artist?: string
  state: InboxState
  error?: string
}

export interface Inbox {
  playlistId: string
  name?: string
  /** When the PC last changed the mirror (it saw a new snapshot, or a quota block). */
  updatedAt: string
  /** Spotify refuses the PC's playlist reads until then (D-35). */
  blockedUntil?: string
  tracks: InboxSong[]
}

export type InboxResult =
  | { status: 'ok'; inbox: Inbox; fetchedAt: number; stale: boolean }
  | { status: 'none' }
  | { status: 'error'; message: string }

interface Cached {
  inbox: Inbox
  fetchedAt: number
}

const KEY = 'inbox'

export async function cachedInbox(): Promise<InboxResult | null> {
  const c = await idbGet<Cached>('settings', KEY)
  return c ? { status: 'ok', inbox: c.inbox, fetchedAt: c.fetchedAt, stale: true } : null
}

export async function fetchInbox(): Promise<InboxResult> {
  try {
    const res = await fetch(`${API_URL}/inbox`, { cache: 'no-store' })
    if (res.status === 404) return { status: 'none' }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const inbox = (await res.json()) as Inbox
    const fetchedAt = Date.now()
    await idbSet('settings', KEY, { inbox, fetchedAt } satisfies Cached)
    // titles for Stand's header and the recorded list, without a Spotify call per song
    for (const t of inbox.tracks)
      if (t.title && !(await idbGet('tracks', t.id)))
        await idbSet('tracks', t.id, { id: t.id, title: t.title, ...(t.artist ? { artist: t.artist } : {}) } satisfies TrackMeta)
    log('info', 'inbox.fetch', { songs: inbox.tracks.length, blocked: inbox.blockedUntil ?? null })
    return { status: 'ok', inbox, fetchedAt, stale: false }
  } catch (e) {
    return (await cachedInbox()) ?? { status: 'error', message: String(e) }
  }
}

/** The quota block, if it is still in force at `now`. */
export const blockedUntil = (inbox: Inbox, now = Date.now()): Date | null => {
  const t = inbox.blockedUntil ? Date.parse(inbox.blockedUntil) : NaN
  return t > now ? new Date(t) : null
}

export const STATE_LABEL: Record<InboxState, string> = {
  analysed: 'Analysed',
  queued: 'Queued',
  working: 'Working',
  failed: 'Failed',
  new: 'Waiting',
}
