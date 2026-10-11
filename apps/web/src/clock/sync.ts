// The sync badge (sketch "When things aren't perfect"): how far to trust the chart right now.
// Locked (±ms), Re-syncing (after a seek, skip or network hiccup), Paused, Not connected; plus Nothing
// playing (Spotify has no active device) and Manual (the app's own clock).

export type SyncState =
  | { kind: 'locked'; ms: number }
  | { kind: 'resync' }
  | { kind: 'paused' }
  | { kind: 'idle' }
  | { kind: 'offline' }
  | { kind: 'manual'; playing: boolean }

export interface SyncInput {
  authed: boolean
  now: number
  /** the last poll failed (network or HTTP error) */
  failing: boolean
  lastOkAt: number | null
  locked: boolean
  playing: boolean
  quality: { sinceMs: number; samples: number; errMs: number } | null
}

/** No answer for this long while polling → Not connected. */
export const OFFLINE_AFTER_MS = 5000
/** No answer for this long while playing → Re-syncing. */
export const STALE_AFTER_MS = 2500
/** A new segment counts as locked after this long and two samples. */
export const SETTLE_MS = 1200

export function syncState(i: SyncInput): SyncState {
  if (!i.authed) return { kind: 'offline' }
  const age = i.lastOkAt === null ? Infinity : i.now - i.lastOkAt
  if (i.failing && age > OFFLINE_AFTER_MS) return { kind: 'offline' }
  if (i.lastOkAt === null) return { kind: 'resync' }
  if (!i.locked) return { kind: 'idle' }
  if (!i.playing) return { kind: 'paused' }
  if (age > STALE_AFTER_MS) return { kind: 'resync' }
  const q = i.quality
  if (!q || q.sinceMs < SETTLE_MS || q.samples < 2) return { kind: 'resync' }
  return { kind: 'locked', ms: Math.max(10, Math.ceil(q.errMs / 10) * 10) }
}

export const sameSync = (a: SyncState, b: SyncState): boolean => JSON.stringify(a) === JSON.stringify(b)
