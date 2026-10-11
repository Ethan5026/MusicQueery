// The analysis queue (M5): the phone asks the PC to analyse a Spotify track. The Worker checks the phone's Spotify
// token against its allow-list (the phone has no store secret, D-32); `mqc watch` on the PC works through the queue
// whenever Spotify is idle, so it never takes playback away from the speaker you're listening on.
import { API_URL } from '../config'
import { log } from '../debug/log'
import { accessToken } from '../spotify/auth'

export type QueueStatus =
  | { state: 'none' }
  | { state: 'queued' | 'working'; requestedAt: string }
  | { state: 'failed'; error: string }
  | { state: 'done' }
  | { state: 'unknown'; message: string }

interface QueueJson {
  state: 'queued' | 'working' | 'failed' | 'done'
  requestedAt?: string
  error?: string
}

function toStatus(j: QueueJson): QueueStatus {
  if (j.state === 'failed') return { state: 'failed', error: j.error ?? 'failed' }
  if (j.state === 'done') return { state: 'done' }
  return { state: j.state, requestedAt: j.requestedAt ?? '' }
}

export async function queueStatus(id: string): Promise<QueueStatus> {
  try {
    const res = await fetch(`${API_URL}/queue/${id}`, { cache: 'no-store' })
    if (res.status === 404) return { state: 'none' }
    if (!res.ok) return { state: 'unknown', message: `HTTP ${res.status}` }
    return toStatus((await res.json()) as QueueJson)
  } catch (e) {
    return { state: 'unknown', message: String(e) }
  }
}

export async function requestAnalysis(id: string, meta: { title?: string; artist?: string }): Promise<QueueStatus> {
  try {
    const token = await accessToken()
    if (!token) return { state: 'unknown', message: 'Log in to Spotify first.' }
    const res = await fetch(`${API_URL}/queue/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Spotify-Token': token },
      body: JSON.stringify({ title: meta.title, artist: meta.artist }),
    })
    log(res.ok ? 'info' : 'warn', 'queue.request', { id, status: res.status })
    if (res.status === 401) return { state: 'unknown', message: 'This Spotify account isn’t allowed to queue analyses.' }
    if (!res.ok) return { state: 'unknown', message: `HTTP ${res.status}` }
    return toStatus((await res.json()) as QueueJson)
  } catch (e) {
    return { state: 'unknown', message: String(e) }
  }
}
