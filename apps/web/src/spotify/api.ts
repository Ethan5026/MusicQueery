// Spotify Web API calls. Only SpotifyClock, the track library and the debug controls call these (D-16).

import type { PlayerReading } from '../clock/SpotifyClock'
import { log } from '../debug/log'
import { accessToken } from './auth'

const API = 'https://api.spotify.com/v1'

function idle(status: number): PlayerReading {
  return {
    status,
    progressMs: null,
    isPlaying: false,
    trackId: null,
    durationMs: null,
    timestamp: null,
    deviceId: null,
    deviceName: null,
    trackName: null,
    artists: null,
  }
}

async function call(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const token = await accessToken()
  if (!token) throw new Error('not logged in')
  const res = await fetch(`${API}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  })
  if (res.status === 401 && !retried) {
    await accessToken(true)
    return call(path, init, true)
  }
  return res
}

interface PlayerJson {
  progress_ms: number | null
  is_playing: boolean
  timestamp: number | null
  device?: { id: string | null; name: string }
  item?: { id: string; name: string; duration_ms: number; artists?: { name: string }[] } | null
}

export async function fetchPlayer(): Promise<PlayerReading> {
  const res = await call('/me/player')
  if (res.status === 204) return idle(204)
  if (res.status === 429) return { ...idle(429), retryAfterS: Number(res.headers.get('Retry-After') ?? 5) }
  if (!res.ok) throw new Error(`GET /me/player ${res.status}`)
  const j = (await res.json()) as PlayerJson
  return {
    status: 200,
    progressMs: j.progress_ms,
    isPlaying: j.is_playing,
    trackId: j.item?.id ?? null,
    durationMs: j.item?.duration_ms ?? null,
    timestamp: j.timestamp,
    deviceId: j.device?.id ?? null,
    deviceName: j.device?.name ?? null,
    trackName: j.item?.name ?? null,
    artists: j.item?.artists?.map((a) => a.name).join(', ') ?? null,
  }
}

/** Title and artists of one track (batch `/tracks?ids=` is 403 in dev mode, D-35). Null if not logged in or not found. */
export async function fetchTrack(id: string): Promise<{ title: string; artist: string } | null> {
  const res = await call(`/tracks/${id}`)
  if (!res.ok) return null
  const j = (await res.json()) as { name: string; artists?: { name: string }[] }
  return { title: j.name, artist: j.artists?.map((a) => a.name).join(', ') ?? '' }
}

async function command(method: string, path: string): Promise<void> {
  const res = await call(path, { method })
  log(res.ok ? 'info' : 'warn', 'spotify.command', { method, path, status: res.status })
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}`)
}

export const player = {
  play: () => command('PUT', '/me/player/play'),
  pause: () => command('PUT', '/me/player/pause'),
  next: () => command('POST', '/me/player/next'),
  seek: (ms: number) => command('PUT', `/me/player/seek?position_ms=${Math.max(0, Math.round(ms))}`),
}
