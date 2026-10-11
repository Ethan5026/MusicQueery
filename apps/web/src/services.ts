// App-wide singletons. Screens read a clock through the active transport; only the clock talks to Spotify (D-16).
//
// Two drivers (M5): 'spotify' follows whatever Spotify plays on any device (SpotifyClock), and 'manual' runs a
// recorded timeline on the app's own clock (ManualClock, M4). Spotify takes over when it locks onto a track, changes
// track, or starts playing; opening a recorded track in Tracks hands back to the manual clock. When Spotify has
// nothing active the chart stays where it was, on the manual clock, paused.

import type { Timeline } from '@mq/model'
import { create } from 'zustand'
import { ManualClock } from './clock/ManualClock'
import { SpotifyClock } from './clock/SpotifyClock'
import { offsetFor, startBiasStore } from './clock/offsets'
import type { Clock } from './clock/types'
import { log } from './debug/log'
import { fetchPlayer, player } from './spotify/api'
import { loadTokens, sp1Record, type Sp1Record } from './spotify/auth'
import { idbGet, idbSet } from './store/idb'
import { DEMO_ID, type LoadResult, type TrackMeta, loadTimeline, revalidate, trackMeta } from './timeline/library'
import { wakeLock } from './wakelock'

export const clock = new SpotifyClock({
  fetchPlayer,
  offsetFor,
  startBias: startBiasStore,
  onError: (err) => log('warn', 'clock.poll_failed', { err: String(err) }),
})

clock.onJump((e) => log('info', 'clock.jump', e))

/** The app's own transport for recorded timelines (M4). */
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

// ---------------------------------------------------------------- transport

export type Driver = 'spotify' | 'manual'

/** What a screen needs to show and steer the playhead, whichever clock drives it. */
export interface Transport {
  driver: Driver
  clock: Clock
  durationMs: () => number
  toggle: () => void
  /** Seek so that the chart shows `ms`. */
  seek: (ms: number) => void
  /** Called every frame while playing. */
  tick: () => void
}

const manualTransport: Transport = {
  driver: 'manual',
  clock: manual,
  durationMs: () => manual.durationMs,
  toggle: () => manual.toggle(),
  seek: (ms) => manual.seek(ms),
  tick: () => void manual.checkEnd(),
}

/** Send a player command, then poll at once so the clock picks up the change. */
function command(p: Promise<void>): void {
  p.catch((err: unknown) => log('warn', 'spotify.command_failed', { err: String(err) })).finally(() => clock.pollNow())
}

const spotifyTransport: Transport = {
  driver: 'spotify',
  clock,
  durationMs: () => clock.last?.durationMs ?? useSession.getState().timeline?.durationMs ?? 0,
  toggle: () => command(clock.playing ? player.pause() : player.play()),
  // The chart shows Spotify's position + start bias + device offset; aim the seek so it lands on `ms`.
  seek: (ms) => command(player.seek(ms - clock.offsetMs - startBiasStore.get(clock.last?.deviceId ?? null))),
  tick: () => {},
}

export const transportFor = (d: Driver): Transport => (d === 'spotify' ? spotifyTransport : manualTransport)
export const activeTransport = (): Transport => transportFor(useSession.getState().driver)

// ---------------------------------------------------------------- session

export type Tab = 'stand' | 'tracks' | 'map' | 'coach' | 'settings'
export const TABS: Tab[] = ['stand', 'tracks', 'map', 'coach', 'settings']

interface SessionState {
  tab: Tab
  driver: Driver
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

/** Bumped by every open/follow; a load that finishes after a newer one started is dropped. */
let seq = 0

export const useSession = create<SessionState>((set, get) => ({
  tab: tabFromHash(),
  driver: 'manual',
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
    const mine = ++seq
    const keep = get()
    set({ status: 'loading', error: '' })
    const [r, meta] = await Promise.all([loadTimeline(id), trackMeta(id)])
    if (mine !== seq) return r
    if (r.status !== 'ok') {
      // Keep whatever was open; report why the new one didn't load.
      set({ status: keep.timeline ? 'ok' : r.status, error: r.status === 'missing' ? 'missing' : r.message })
      return r
    }
    manual.load(id, r.timeline.durationMs, startMs)
    set({ driver: 'manual', id, timeline: r.timeline, meta, status: 'ok', error: '' })
    log('info', 'session.open', { id, from: r.from, chords: r.timeline.chords.length, startMs: Math.round(startMs) })
    if (r.from === 'cache') refreshLater(id, mine)
    saveSession()
    return r
  },
}))

/** Title and artist straight from /me/player, so following needs no extra request. */
function metaFromPlayer(id: string): TrackMeta | null {
  const r = clock.last
  if (!r?.trackName || `spotify:track:${r.trackId}` !== id) return null
  return { id, title: r.trackName, ...(r.artists ? { artist: r.artists } : {}) }
}

/** Follow the track Spotify is playing: its timeline from IndexedDB or the store (fetch + cache by track ID). */
async function follow(trackId: string): Promise<void> {
  const id = `spotify:track:${trackId}`
  manual.pause()
  const s = useSession.getState()
  const meta = metaFromPlayer(id)
  if (meta) void idbSet('tracks', id, meta)
  if (s.id === id && s.timeline) {
    ++seq
    useSession.setState({ driver: 'spotify', meta: meta ?? s.meta, status: 'ok', error: '' })
    log('info', 'session.follow', { id, from: 'open' })
    return
  }
  const mine = ++seq
  useSession.setState({ driver: 'spotify', id, timeline: null, meta, status: 'loading', error: '' })
  const [r, m] = await Promise.all([loadTimeline(id), meta ?? trackMeta(id)])
  if (mine !== seq) return
  log('info', 'session.follow', { id, status: r.status, ...(r.status === 'ok' ? { from: r.from } : {}) })
  if (r.status === 'ok') {
    useSession.setState({ timeline: r.timeline, meta: m, status: 'ok' })
    if (r.from === 'cache') refreshLater(id, mine)
    saveSession()
  } else useSession.setState({ meta: m, status: r.status, error: r.status === 'error' ? r.message : '' })
}

/** A cached timeline may have been re-analysed on the PC since: check the store in the background. */
function refreshLater(id: string, mine: number): void {
  const tl = useSession.getState().timeline
  if (!tl || !id.startsWith('spotify:') || !navigator.onLine) return
  void revalidate(id, tl).then((fresh) => {
    if (fresh && mine === seq && useSession.getState().id === id) {
      useSession.setState({ timeline: fresh })
      log('info', 'session.refreshed', { id, createdAt: fresh.createdAt })
    }
  })
}

/** Ask the follow logic again (e.g. after a timeline was analysed for the current track). */
export function retryFollow(): void {
  const t = clock.trackId
  if (t) {
    useSession.setState({ id: null })
    void follow(t)
  }
}

clock.onJump((e) => {
  const s = useSession.getState()
  if (e.trackId && (e.kind === 'lock' || e.kind === 'track' || (e.kind === 'play' && s.driver !== 'spotify'))) {
    void follow(e.trackId)
  } else if (e.kind === 'idle' && s.driver === 'spotify') {
    // Nothing active on Spotify: hold the chart where it was, on the manual clock.
    ++seq
    if (s.id && s.timeline) {
      manual.load(s.id, s.timeline.durationMs, e.fromMs)
      useSession.setState({ driver: 'manual' })
    } else useSession.setState({ driver: 'manual', id: null, meta: null, timeline: null, status: 'idle', error: '' })
  }
  if (useSession.getState().driver === 'spotify') {
    updateWake()
    if (e.kind !== 'play' && e.kind !== 'resync') saveSession()
  }
})

interface SavedSession {
  id: string
  positionMs: number
}

function saveSession(): void {
  const { id, driver, timeline } = useSession.getState()
  if (id && timeline)
    void idbSet('settings', 'session', { id, positionMs: transportFor(driver).clock.positionMs() } satisfies SavedSession)
}

/** Reopens the last timeline where it was left (paused), unless Spotify got there first. With nothing saved, a
 *  logged-in phone waits for Spotify ("Nothing playing"); a logged-out one opens the demo chart. */
export async function restoreSession(): Promise<void> {
  const s = await idbGet<SavedSession>('settings', 'session')
  if (useSession.getState().driver === 'spotify') return
  const r = s ? await useSession.getState().open(s.id, s.positionMs) : null
  if (r?.status === 'ok' || useSession.getState().driver === 'spotify') return
  if (!useApp.getState().authed) await useSession.getState().open(DEMO_ID)
}

let wakeOn = false
function updateWake(): void {
  const want = activeTransport().clock.playing
  if (want === wakeOn) return
  wakeOn = want
  void (want ? wakeLock.enable() : wakeLock.disable())
}

manual.onJump((e) => {
  if (useSession.getState().driver !== 'manual') return
  updateWake()
  if (e.kind !== 'play') saveSession()
})
useSession.subscribe((s, prev) => {
  if (s.driver !== prev.driver) updateWake()
})
document.addEventListener('visibilitychange', () => {
  // iOS drops the wake lock when the app is hidden; take it again on return if still playing.
  if (document.visibilityState === 'hidden') {
    saveSession()
    wakeOn = false
  } else updateWake()
})
