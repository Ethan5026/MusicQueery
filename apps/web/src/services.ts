// App-wide singletons. Screens read a clock through the active transport; only the clock talks to Spotify (D-16).
//
// Three drivers: 'spotify' follows whatever Spotify plays on any device (SpotifyClock, M5), 'manual' runs a recorded
// timeline on the app's own clock (ManualClock, M4), and 'audio' is the backing band on the Web Audio clock (M6).
// Spotify takes over when it locks onto a track, changes track, or starts playing (while the band plays, only when
// Spotify starts playing, and the band then pauses); opening a recorded track in Tracks hands back to the manual
// clock. When Spotify has nothing active the chart stays where it was, on the manual clock, paused.

import type { Part } from '@mq/band'
import type { Timeline } from '@mq/model'
import { create } from 'zustand'
import { unlock } from './audio/context'
import { type Loop, band } from './audio/engine'
import { loadKit } from './audio/kit'
import { type BandSpec, chartFor, specLine } from './audio/library'
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

export type Driver = 'spotify' | 'manual' | 'audio'

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
  tick: () => {
    const loop = useLoop.getState().loop
    if (loop && manual.playing && manual.positionMs() >= loop.endMs) manual.seek(loop.startMs)
    else manual.checkEnd()
  },
}

const audioTransport: Transport = {
  driver: 'audio',
  clock: band,
  durationMs: () => band.durationMs,
  toggle: () => (band.playing ? band.pause() : void playBand()),
  seek: (ms) => band.seek(ms),
  tick: () => void band.checkEnd(),
}

/** Send a player command, then poll at once so the clock picks up the change. */
function command(p: Promise<void>): void {
  p.catch((err: unknown) => log('warn', 'spotify.command_failed', { err: String(err) })).finally(() => clock.pollNow())
}

// The chart shows Spotify's position + start bias + device offset; aim a seek so it lands on `ms`.
const spotifySeek = (ms: number) => command(player.seek(ms - clock.offsetMs - startBiasStore.get(clock.last?.deviceId ?? null)))

/** Spotify takes a few hundred ms to act on a seek, so the loop jumps back this early (learned from each jump). */
let loopLeadMs = 150
let loopJump: { sentAt: number; fromMs: number; to: number } | null = null

const spotifyTransport: Transport = {
  driver: 'spotify',
  clock,
  durationMs: () => clock.last?.durationMs ?? useSession.getState().timeline?.durationMs ?? 0,
  toggle: () => command(clock.playing ? player.pause() : player.play()),
  seek: spotifySeek,
  tick: () => {
    const loop = useLoop.getState().loop
    if (!loop || !clock.playing) return
    const now = performance.now()
    if (loopJump && now - loopJump.sentAt < 2500) return
    const pos = clock.positionMs()
    if (pos >= loop.endMs - loopLeadMs && pos < loop.endMs + 4000) {
      loopJump = { sentAt: now, fromMs: pos, to: loop.startMs }
      spotifySeek(loop.startMs)
    }
  },
}

// How long a loop seek took to land; the next jump is sent that much before the loop's end.
clock.onJump((e) => {
  if (!loopJump || (e.kind !== 'seek' && e.kind !== 'resync') || Math.abs(e.toMs - loopJump.to) > 1500) return
  const took = e.at - loopJump.sentAt
  const loop = useLoop.getState().loop
  log('info', 'loop.jump', {
    tookMs: Math.round(took),
    sentBeforeEndMs: loop ? Math.round(loop.endMs - loopJump.fromMs) : null,
    leadMs: loopLeadMs,
  })
  loopLeadMs = Math.min(800, Math.max(80, Math.round(loopLeadMs * 0.5 + took * 0.5)))
  loopJump = null
})

export const transportFor = (d: Driver): Transport =>
  d === 'spotify' ? spotifyTransport : d === 'audio' ? audioTransport : manualTransport
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
  /** the backing track behind the 'audio' driver */
  band: BandSpec | null
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
  band: null,
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
    band.pause()
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
  band.pause()
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
  // while the band plays, only Spotify starting to play takes over
  const bandBusy = s.driver === 'audio' && band.playing && e.kind !== 'play'
  if (!bandBusy && e.trackId && (e.kind === 'lock' || e.kind === 'track' || (e.kind === 'play' && s.driver !== 'spotify'))) {
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
  band?: BandSpec
}

function saveSession(): void {
  const { id, driver, timeline, band: spec } = useSession.getState()
  if (id && timeline)
    void idbSet('settings', 'session', {
      id,
      positionMs: transportFor(driver).clock.positionMs(),
      ...(driver === 'audio' && spec ? { band: spec } : {}),
    } satisfies SavedSession)
}

/** Reopens the last timeline where it was left (paused), unless Spotify got there first. With nothing saved, a
 *  logged-in phone waits for Spotify ("Nothing playing"); a logged-out one opens the demo chart. */
export async function restoreSession(): Promise<void> {
  const s = await idbGet<SavedSession>('settings', 'session')
  if (useSession.getState().driver === 'spotify') return
  if (s?.band && (await openBand(s.band, s.positionMs))) return
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
band.onJump((e) => {
  if (useSession.getState().driver !== 'audio') return
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

// ---------------------------------------------------------------- loop

/** An A–B loop on bar lines for whichever clock drives (M6): exact on the band, a seek on Spotify. */
interface LoopState {
  loop: Loop | null
  /** start set, waiting for the end */
  pendingStart: number | null
  set: (loop: Loop | null) => void
  setPending: (ms: number | null) => void
}

export const useLoop = create<LoopState>((set) => ({
  loop: null,
  pendingStart: null,
  set: (loop) => {
    set({ loop, pendingStart: null })
    band.setLoop(useSession.getState().driver === 'audio' ? loop : null)
    loopJump = null
    log('info', 'loop.set', loop ? { startMs: Math.round(loop.startMs), endMs: Math.round(loop.endMs) } : { off: true })
  },
  setPending: (pendingStart) => set({ pendingStart }),
}))

// A loop belongs to one track on one clock.
useSession.subscribe((s, prev) => {
  const l = useLoop.getState()
  if ((s.id !== prev.id || s.driver !== prev.driver) && (l.loop || l.pendingStart !== null)) l.set(null)
})

// ---------------------------------------------------------------- band

export interface BandPrefs {
  mutes: Record<Part, boolean>
  /** count-in bars (0–2) before each start */
  countIn: number
}

interface BandUi extends BandPrefs {
  /** kit download progress 0..1 while loading, null otherwise */
  loading: number | null
  error: string
  setMute: (p: Part, muted: boolean) => void
  setCountIn: (n: number) => void
}

const saveBandPrefs = (p: BandPrefs) => void idbSet('settings', 'band', { mutes: p.mutes, countIn: p.countIn } satisfies BandPrefs)

export const useBand = create<BandUi>((set, get) => ({
  mutes: { piano: false, bass: false, drums: false },
  countIn: 1,
  loading: null,
  error: '',
  setMute: (p, muted) => {
    set({ mutes: { ...get().mutes, [p]: muted } })
    band.setMute(p, muted)
    saveBandPrefs(get())
  },
  setCountIn: (countIn) => {
    set({ countIn })
    band.opts.countIn = countIn
    saveBandPrefs(get())
  },
}))

export async function loadBandPrefs(): Promise<void> {
  const p = await idbGet<BandPrefs>('settings', 'band')
  if (!p) return
  useBand.setState({ mutes: { ...useBand.getState().mutes, ...p.mutes }, countIn: p.countIn ?? 1 })
}

/** Unlocks audio (must start inside a tap) and loads the kit once. Resolves false if either failed. */
export async function ensureBand(): Promise<boolean> {
  try {
    if (typeof AudioContext === 'undefined') throw new Error('this browser has no Web Audio')
    const ctx = await unlock()
    if (band.ready) return true
    useBand.setState({ loading: 0, error: '' })
    const kit = await loadKit(ctx, (f) => useBand.setState({ loading: f }))
    band.attach(ctx, kit)
    for (const [p, m] of Object.entries(useBand.getState().mutes)) band.setMute(p as Part, m)
    useBand.setState({ loading: null })
    return true
  } catch (err) {
    useBand.setState({ loading: null, error: `Couldn’t start the band: ${String(err)}` })
    return false
  }
}

/** Starts the band (from a tap), pausing Spotify if it plays somewhere so the two don't play over each other. */
export async function playBand(): Promise<boolean> {
  const ok = await ensureBand()
  if (!ok || useSession.getState().driver !== 'audio') return false
  if (clock.playing) command(player.pause())
  band.opts.countIn = useBand.getState().countIn
  band.play()
  return true
}

/** Opens a backing track on the band's clock, paused at `startMs`. False if its chart is gone. */
export async function openBand(spec: BandSpec, startMs = 0): Promise<boolean> {
  const mine = ++seq
  const chart = await chartFor(spec)
  if (mine !== seq) return false
  if (!chart) {
    log('warn', 'band.missing', { ref: spec.ref })
    return false
  }
  manual.pause()
  const { countIn } = useBand.getState()
  const timeline = band.load(chart, { bpm: spec.bpm, style: spec.style, choruses: spec.choruses, countIn })
  if (startMs > 0) band.seek(startMs)
  useSession.setState({
    driver: 'audio',
    id: timeline.id,
    timeline,
    meta: { id: timeline.id, title: chart.title, artist: specLine(spec), ...(chart.style ? { style: chart.style } : {}) },
    status: 'ok',
    error: '',
    band: spec,
  })
  log('info', 'band.open', { ...spec })
  saveSession()
  return true
}

/** Changes the open backing track's key, tempo, style or choruses, keeping the place (live while playing). */
export async function updateBand(patch: Partial<BandSpec>): Promise<void> {
  const s = useSession.getState()
  if (s.driver !== 'audio' || !s.band) return
  const spec = { ...s.band, ...patch }
  const chart = patch.key !== undefined && patch.key !== s.band.key ? await chartFor(spec) : null
  const timeline = band.update({ ...(chart ? { chart } : {}), bpm: spec.bpm, style: spec.style, choruses: spec.choruses })
  if (!timeline) return
  useSession.setState({ band: spec, id: timeline.id, timeline, meta: s.meta ? { ...s.meta, artist: specLine(spec) } : s.meta })
  saveSession()
}
