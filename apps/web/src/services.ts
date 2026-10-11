// App-wide singletons. Screens read a clock; only the clock talks to Spotify (D-16).

import type { Timeline } from '@mq/model'
import { create } from 'zustand'
import { ManualClock } from './clock/ManualClock'
import { SpotifyClock } from './clock/SpotifyClock'
import { offsetFor, startBiasStore } from './clock/offsets'
import { log } from './debug/log'
import { fetchPlayer } from './spotify/api'
import { loadTokens, sp1Record, type Sp1Record } from './spotify/auth'
import { idbGet, idbSet } from './store/idb'
import { DEMO_ID, type LoadResult, type TrackMeta, loadTimeline, trackMeta } from './timeline/library'
import { wakeLock } from './wakelock'

export const clock = new SpotifyClock({
  fetchPlayer,
  offsetFor,
  startBias: startBiasStore,
  onError: (err) => log('warn', 'clock.poll_failed', { err: String(err) }),
})

clock.onJump((e) => log('info', 'clock.jump', e))

/** M4: the Stand runs on a recorded timeline under the app's own transport. M5 adds SpotifyClock. */
export const manual = new ManualClock()

interface AppState {
  authed: boolean
  sp1: Sp1Record | null
  refreshAuth: () => void
}

export const useApp = create<AppState>((set) => ({
  authed: loadTokens() !== null,
  sp1: sp1Record(),
  refreshAuth: () => set({ authed: loadTokens() !== null, sp1: sp1Record() }),
}))

/** Poll only while logged in and visible (D-03: off when hidden). */
export function runClock(): void {
  const sync = () => {
    if (useApp.getState().authed && document.visibilityState === 'visible') clock.start()
    else clock.stop()
  }
  document.addEventListener('visibilitychange', sync)
  useApp.subscribe(sync)
  sync()
}

// ---------------------------------------------------------------- session

export type Tab = 'stand' | 'tracks' | 'map' | 'coach' | 'settings'
export const TABS: Tab[] = ['stand', 'tracks', 'map', 'coach', 'settings']

interface SessionState {
  tab: Tab
  id: string | null
  timeline: Timeline | null
  meta: TrackMeta | null
  status: 'idle' | 'loading' | 'ok' | 'missing' | 'error'
  error: string
  setTab: (tab: Tab) => void
  /** Opens a recorded timeline under the ManualClock. Resolves to the load result. */
  open: (id: string, startMs?: number) => Promise<LoadResult>
}

const tabFromHash = (): Tab => {
  const h = location.hash.slice(1) as Tab
  return TABS.includes(h) ? h : 'stand'
}

export const useSession = create<SessionState>((set, get) => ({
  tab: tabFromHash(),
  id: null,
  timeline: null,
  meta: null,
  status: 'idle',
  error: '',
  setTab: (tab) => {
    history.replaceState(null, '', `#${tab}`)
    set({ tab })
  },
  open: async (id, startMs = 0) => {
    const keep = get()
    set({ status: 'loading', error: '' })
    const [r, meta] = await Promise.all([loadTimeline(id), trackMeta(id)])
    if (r.status !== 'ok') {
      // Keep whatever was open; report why the new one didn't load.
      set({ status: keep.timeline ? 'ok' : r.status, error: r.status === 'missing' ? 'missing' : r.message })
      return r
    }
    manual.load(id, r.timeline.durationMs, startMs)
    set({ id, timeline: r.timeline, meta, status: 'ok', error: '' })
    log('info', 'session.open', { id, from: r.from, chords: r.timeline.chords.length, startMs: Math.round(startMs) })
    saveSession()
    return r
  },
}))

interface SavedSession {
  id: string
  positionMs: number
}

function saveSession(): void {
  const id = useSession.getState().id
  if (id) void idbSet('settings', 'session', { id, positionMs: manual.positionMs() } satisfies SavedSession)
}

/** Reopens the last timeline where it was left (paused), or the demo. */
export async function restoreSession(): Promise<void> {
  const s = await idbGet<SavedSession>('settings', 'session')
  const r = s ? await useSession.getState().open(s.id, s.positionMs) : null
  if (r?.status !== 'ok') await useSession.getState().open(DEMO_ID)
}

manual.onJump((e) => {
  if (e.kind === 'play') void wakeLock.enable()
  if (e.kind === 'pause' || e.kind === 'track') void wakeLock.disable()
  if (e.kind !== 'play') saveSession()
})
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveSession()
})
