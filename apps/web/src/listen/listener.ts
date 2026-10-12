// Listening live (M7, D-04): the phone's mic → AudioWorklet → decoder Worker, lined up with the track through
// SpotifyClock (the same frame → performance.now() → position mapping the M1 drift probe validated). While
// Listen is on, a Spotify track with no analysed timeline is decoded as it plays: Stand shows the chord heard now,
// and ahead of it whatever an earlier listen or the song's own repeats predict. Each stretch of playback is
// re-decoded when it ends (seek, pause, track change, stop) and saved as the track's live timeline.
//
// Test mode (SP7, Settings → Diagnostics) decodes even when the track is analysed, and scores the live chord
// against the analysed one as it plays; the live result is saved and uploaded too, for scoring on the PC.
//
// Timing (SP7 follow-up, D-70: saved chords were ~2.5 s late on the iPhone). A mic frame's track time is the
// SpotifyClock position (which includes the speaker's calibrated offset) at the moment the sample was *recorded*.
// `getOutputTimestamp` gives when a frame is *played*, so the phone's round trip (output → input, measured by the
// echo test and kept per phone) is taken off. Test mode measures what is still late on an analysed track
// (`bestShift`) for the Mic test card. It is not corrected: on the iPhone it held steady within a listen but changed
// from one start to the next (0.8–3.75 s, D-71), and the user parked the mic's timing.
import type { Timeline } from '@mq/model'
import { LIVE_GENERATOR, type Shift, bestShift, chirp, findEcho, liveTimeline, mergeLive } from '@mq/listen'
import { canonical, parseChord, pc } from '@mq/theory'
import { create } from 'zustand'
import { log } from '../debug/log'
import { clock, holdWake, useSession } from '../services'
import { chordAt } from '../timeline/fetch'
import { loadLive, saveLive } from '../timeline/live'
import type { FinalMsg, FromWorker, NowMsg, ToWorker, TrackChord } from './decoder.worker'
import workletUrl from './mic-processor.js?url'

export type ListenMode = 'listen' | 'test'

interface AudioSessionLike {
  type: string
}

export interface ListenInfo {
  sampleRate?: number
  baseLatencyMs?: number
  outputLatencyMs?: number
  /** the echo test's stored round trip when listening started */
  roundTripMs?: number | null
  settings?: MediaTrackSettings
  audioSession?: string
}

interface ListenState {
  status: 'off' | 'starting' | 'on' | 'error'
  mode: ListenMode
  error: string
  /** latest decoder output (any track) */
  now: NowMsg | null
  /** mic peak (0..1) and worklet time per second of audio (ms), ~10 Hz */
  peak: number
  workletMs: number
  info: ListenInfo
  /** test mode: beats where the live chord matched the analysed one (root + third), of beats compared */
  agree: { hit: number; n: number }
  saved: number
  /** test mode: the shift that best lines this segment's settled chords up with the analysis */
  heard: Shift | null
  echo: EchoState
}

export interface EchoState {
  status: 'idle' | 'running' | 'done' | 'failed'
  /** round trip per round (ms), null where no echo was found */
  rounds: Array<number | null>
  message?: string
}

export const useListen = create<ListenState>(() => ({
  status: 'off',
  mode: 'listen',
  error: '',
  now: null,
  peak: 0,
  workletMs: 0,
  info: {},
  agree: { hit: 0, n: 0 },
  saved: 0,
  heard: null,
  echo: { status: 'idle', rounds: [] },
}))

// ---------------------------------------------------------------- the phone's mic round trip

const ECHO_KEY = 'mq.micRoundTrip'

/** The phone's measured output → input round trip (ms), or null if the echo test has not been run. */
export function micRoundTripMs(): number | null {
  try {
    const raw = localStorage.getItem(ECHO_KEY)
    const v = Number(raw)
    return raw !== null && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

function setMicRoundTrip(ms: number | null): void {
  try {
    if (ms === null) localStorage.removeItem(ECHO_KEY)
    else localStorage.setItem(ECHO_KEY, String(Math.round(ms)))
  } catch {
    // storage blocked: this session only
  }
  roundTrip = ms ?? 0
}

let roundTrip = micRoundTripMs() ?? 0

let ctx: AudioContext | null = null
let stream: MediaStream | null = null
let node: AudioWorkletNode | null = null
let worker: Worker | null = null
let anchorTimer = 0
let offJump: (() => void) | null = null
let prevSessionType: string | null = null
/** saved live timeline of the track being followed (earlier listens) */
let base: { id: string; tl: Timeline | null } | null = null

const send = (m: ToWorker, transfer: Transferable[] = []) => worker?.postMessage(m, transfer)

/** Starts the mic (call from a tap: iOS needs the gesture for getUserMedia and the AudioContext). */
export async function startListening(mode: ListenMode = 'listen'): Promise<boolean> {
  if (useListen.getState().status === 'on' || useListen.getState().status === 'starting') {
    useListen.setState({ mode })
    return true
  }
  useListen.setState({ status: 'starting', mode, error: '', agree: { hit: 0, n: 0 }, heard: null })
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('this browser has no microphone access')
    if (typeof AudioWorkletNode === 'undefined') throw new Error('this browser has no AudioWorklet')
    const session = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession
    if (session) {
      prevSessionType = session.type
      try {
        session.type = 'play-and-record'
      } catch {
        // older Safari: the default session records too
      }
    }
    // Raw mic: no echo cancellation, noise suppression or gain riding, which smear chords (SP7).
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    ctx = new AudioContext()
    if (ctx.state !== 'running') await ctx.resume()
    await ctx.audioWorklet.addModule(workletUrl)
    node = new AudioWorkletNode(ctx, 'mic-processor')
    worker = new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<FromWorker>) => onWorker(e.data)
    worker.onerror = (e) => fail(`decoder: ${e.message}`)
    const ch = new MessageChannel()
    node.port.postMessage({ port: ch.port1 }, [ch.port1])
    send({ type: 'start', sampleRate: ctx.sampleRate, port: ch.port2 }, [ch.port2])
    node.port.onmessage = (e: MessageEvent<WorkletMsg>) => {
      if (e.data.type === 'meter') useListen.setState({ peak: e.data.peak, workletMs: e.data.busyMs * 10 })
      else if (e.data.type === 'recorded') onRecorded?.(e.data)
    }
    const src = ctx.createMediaStreamSource(stream)
    const mute = ctx.createGain()
    mute.gain.value = 0
    src.connect(node).connect(mute).connect(ctx.destination)
    anchorTimer = window.setInterval(sendAnchor, 200)
    sendAnchor()
    offJump = clock.onJump((e) => {
      if (e.kind === 'seek' || e.kind === 'track' || e.kind === 'pause' || e.kind === 'idle') send({ type: 'segment', reason: e.kind })
      if (e.kind === 'track' || e.kind === 'lock') void loadBase()
    })
    void loadBase()
    const track = stream.getAudioTracks()[0]
    const info: ListenInfo = {
      sampleRate: ctx.sampleRate,
      baseLatencyMs: Math.round(ctx.baseLatency * 10000) / 10,
      ...(track ? { settings: track.getSettings() } : {}),
      ...(session ? { audioSession: session.type } : {}),
      ...(ctx.outputLatency !== undefined ? { outputLatencyMs: Math.round(ctx.outputLatency * 10000) / 10 } : {}),
      roundTripMs: micRoundTripMs(),
    }
    // iOS stops the mic when the screen locks, so listening keeps it on (SP7 lost 70 s to a lock)
    holdWake('listen', true)
    useListen.setState({ status: 'on', info })
    log('info', 'listen.start', { mode, ...info, settings: info.settings ? JSON.stringify(info.settings) : null })
    return true
  } catch (err) {
    fail(String(err))
    return false
  }
}

export function stopListening(reason = 'stop'): void {
  if (useListen.getState().status === 'off') return
  send({ type: 'stop' })
  // let the worker post its final segment before it goes
  const w = worker
  setTimeout(() => w?.terminate(), 1500)
  worker = null
  window.clearInterval(anchorTimer)
  offJump?.()
  offJump = null
  node?.disconnect()
  node = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  void ctx?.close()
  ctx = null
  const session = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession
  if (session && prevSessionType !== null) {
    try {
      session.type = prevSessionType
    } catch {
      // ignore
    }
  }
  holdWake('listen', false)
  useListen.setState({ status: 'off', now: null, peak: 0 })
  useSession.setState({ live: null })
  log('info', 'listen.stop', { reason })
}

function fail(message: string): void {
  log('warn', 'listen.failed', { err: message })
  stopListening('error')
  useListen.setState({ status: 'error', error: message })
}

// iOS stops the mic in the background: finish the segment and stop cleanly.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && useListen.getState().status === 'on') stopListening('hidden')
})

/** Mic frame ↔ track position, five times a second: when the frame is played, less the round trip = when its
 *  input sample was recorded. */
function sendAnchor(): void {
  if (!ctx) return
  const frame = Math.round(ctx.currentTime * ctx.sampleRate)
  const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null
  const played =
    ts?.performanceTime && ts.contextTime !== undefined
      ? ts.performanceTime - (ts.contextTime - frame / ctx.sampleRate) * 1000
      : performance.now() + (ctx.outputLatency ?? 0) * 1000
  const perf = played - roundTrip
  const tid = clock.trackId
  send({
    type: 'anchor',
    anchor: { frame, trackMs: clock.positionMs(perf), playing: clock.playing, trackId: tid ? `spotify:track:${tid}` : null },
  })
}

/** The saved live timeline of the followed track: a prior for the decoder and the look-ahead on Stand. */
async function loadBase(): Promise<void> {
  const tid = clock.trackId
  if (!tid) return
  const id = `spotify:track:${tid}`
  if (base?.id === id) return
  base = { id, tl: null }
  const tl = await loadLive(id)
  if (base?.id !== id) return
  base = { id, tl }
  if (tl) send({ type: 'prior', trackId: id, chords: tl.chords.map((c) => ({ ...c, confidence: c.confidence ?? 0.5 })) })
}

// ---------------------------------------------------------------- worker output

let lastViewKey = ''

function onWorker(m: FromWorker): void {
  if (m.type === 'error') return fail(m.message)
  if (m.type === 'final') return void onFinal(m)
  useListen.setState({ now: m })
  scoreTest(m)
  measureShift(m)
  updateView(m)
}

/** Should Stand show the live view for the session's track? Only when it has no analysed or exact timeline. */
function showsLive(id: string | null): boolean {
  const s = useSession.getState()
  if (s.driver !== 'spotify' || !id || s.id !== id) return false
  return !s.timeline || s.timeline.source === 'live'
}

/** Stand's timeline while listening: earlier listens, this segment's settled chords, the chord heard now, then
 *  the predicted ones. Rebuilt when the chord or the settled part changes. */
function updateView(m: NowMsg): void {
  if (!showsLive(m.trackId)) {
    if (useSession.getState().live) useSession.setState({ live: null })
    return
  }
  const key = `${m.trackId}|${m.symbol}|${m.settled.length}|${m.settled[m.settled.length - 1]?.endMs ?? 0}|${m.predicted.length}`
  if (key === lastViewKey) return
  lastViewKey = key
  const id = m.trackId!
  const nowMs = clock.positionMs()
  const settledEnd = m.settled[m.settled.length - 1]?.endMs ?? m.sinceMs
  const chords: TrackChord[] = [...m.settled]
  const sym = m.symbol && canonical(m.symbol) ? m.symbol : null
  const curEnd = nowMs + 1500
  if (sym) chords.push({ startMs: Math.min(settledEnd, m.sinceMs), endMs: curEnd, symbol: sym, confidence: m.confidence })
  const prior = base?.id === id ? base.tl : null
  // Predicted from the song's repeats, only where no earlier listen covers it
  const coveredTo = prior?.chords[prior.chords.length - 1]?.endMs ?? 0
  for (const p of m.predicted) if (p.startMs >= curEnd && p.startMs >= coveredTo) chords.push(p)
  // beats ahead on the current grid so countdowns and beat dots keep going
  const beats = [...m.beats]
  const period = m.bpm > 0 ? 60000 / m.bpm : 0
  if (period > 0 && beats.length) for (let t = beats[beats.length - 1]! + period; t < nowMs + 10000; t += period) beats.push(t)
  const durationMs = clock.last?.durationMs ?? prior?.durationMs ?? 0
  const seg = liveTimeline({ id, durationMs, chords, beats, createdAt: new Date().toISOString() })
  const view = prior ? mergeLive(prior, seg) : seg
  useSession.setState({ live: view })
}

async function onFinal(m: FinalMsg): Promise<void> {
  if (m.chords.length < 2 || m.seconds < 10) return
  const durationMs = clock.last && `spotify:track:${clock.last.trackId}` === m.trackId ? clock.last.durationMs : 0
  const seg = liveTimeline({
    id: m.trackId,
    durationMs: durationMs || Math.max(...m.chords.map((c) => c.endMs)),
    chords: m.chords,
    beats: m.beats,
    createdAt: new Date().toISOString(),
    generator: LIVE_GENERATOR,
  })
  const saved = await saveLive(seg)
  if (base?.id === m.trackId) base = { id: m.trackId, tl: saved }
  useListen.setState((s) => ({ saved: s.saved + 1 }))
  log('info', 'listen.saved', { id: m.trackId, reason: m.reason, seconds: Math.round(m.seconds), chords: seg.chords.length })
  // a track without an analysis now opens with what was heard
  const s = useSession.getState()
  if (s.id === m.trackId && (!s.timeline || s.timeline.source === 'live')) useSession.setState({ timeline: saved, status: 'ok' })
}

// ---------------------------------------------------------------- SP7 test mode

let lastScoredBeat = -1

/** Test mode: once per beat, does the live chord match the analysed one (root and third)? */
function scoreTest(m: NowMsg): void {
  const s = useSession.getState()
  if (useListen.getState().mode !== 'test' || !s.timeline || s.timeline.source === 'live' || s.id !== m.trackId) return
  const pos = clock.positionMs()
  const beat = Math.floor(pos / (m.bpm > 0 ? 60000 / m.bpm : 500))
  if (beat === lastScoredBeat) return
  lastScoredBeat = beat
  const ref = chordAt(s.timeline, pos)
  if (!ref || !m.symbol) return
  const want = triadKey(ref.symbol)
  if (want === null) return
  const same = triadKey(m.symbol) === want
  useListen.setState((st) => ({ agree: { hit: st.agree.hit + (same ? 1 : 0), n: st.agree.n + 1 } }))
}

/** Root pitch class + minor third or not: what majmin scoring compares. N.C. and unreadable → null. */
function triadKey(symbol: string): string | null {
  const c = parseChord(symbol)
  if (!c || c.kind !== 'chord') return null
  return `${pc(c.root)}${c.third === 'min' ? 'm' : ''}`
}

let lastShiftAt = 0

/** Test mode, every 2 s: the shift (±5 s) that best lines this segment's settled chords up with the analysis. */
function measureShift(m: NowMsg): void {
  const s = useSession.getState()
  if (useListen.getState().mode !== 'test' || !s.timeline || s.timeline.source === 'live' || s.id !== m.trackId) return
  const at = performance.now()
  if (at - lastShiftAt < 2000) return
  lastShiftAt = at
  const first = m.settled[0]
  const last = m.settled[m.settled.length - 1]
  if (!first || !last || last.endMs - first.startMs < 20000) return
  useListen.setState({ heard: bestShift(s.timeline.chords, s.timeline.beats, m.settled) })
}

/** Is the measured shift clear enough to store? Enough beats, a good match, and well above the song's other repeats. */
export function shiftUsable(h: Shift | null): h is Shift {
  return !!h && h.beats >= 24 && h.majmin >= 0.6 && h.majmin - h.runnerUp >= 0.1
}

// ---------------------------------------------------------------- echo test

type WorkletMsg = { type: 'meter'; peak: number; busyMs: number } | { type: 'recorded'; from: number; samples: Float32Array }

let onRecorded: ((m: { from: number; samples: Float32Array }) => void) | null = null

const ECHO_WINDOW_S = 5
const ECHO_ROUNDS = 3

/** Plays a chirp from the phone and finds it in the mic input, three times: the median round trip (output frame →
 *  input frame) is kept for this phone and taken off every anchor. Needs the mic on (Mic test running). */
export async function runEchoTest(): Promise<void> {
  if (!ctx || !node || useListen.getState().echo.status === 'running') return
  const sr = ctx.sampleRate
  const probe = chirp(sr)
  const buf = ctx.createBuffer(1, probe.length, sr)
  buf.getChannelData(0).set(probe)
  const rounds: Array<number | null> = []
  const peaks: number[] = []
  useListen.setState({ echo: { status: 'running', rounds: [] } })
  for (let r = 0; r < ECHO_ROUNDS; r++) {
    const c = ctx
    const n = node
    if (!c || !n) break
    const start = c.currentTime + 0.3
    const from = Math.round(start * sr)
    const got = new Promise<Float32Array | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), (ECHO_WINDOW_S + 2) * 1000)
      onRecorded = (m) => {
        window.clearTimeout(timer)
        resolve(m.from === from ? m.samples : null)
      }
    })
    n.port.postMessage({ type: 'record', from, length: Math.round(ECHO_WINDOW_S * sr) })
    const src = c.createBufferSource()
    src.buffer = buf
    const gain = c.createGain()
    gain.gain.value = 0.9
    src.connect(gain).connect(c.destination)
    src.start(start)
    const rec = await got
    onRecorded = null
    const e = rec ? findEcho(rec, probe, sr) : null
    rounds.push(e ? Math.round((e.lag / sr) * 10000) / 10 : null)
    if (e) peaks.push(Math.round(e.peak * 100) / 100)
    useListen.setState({ echo: { status: 'running', rounds: [...rounds] } })
  }
  const found = rounds.filter((x): x is number => x !== null).sort((a, b) => a - b)
  const ok = found.length >= 2 && found[found.length - 1]! - found[0]! <= 20
  const median = found[found.length >> 1] ?? null
  if (ok) setMicRoundTrip(median)
  log('info', 'listen.echo', { rounds: JSON.stringify(rounds), peaks: JSON.stringify(peaks), ok, roundTripMs: ok ? median : null })
  const message =
    found.length < 2 ? 'no clear echo: turn the phone volume up and keep the room quiet' : 'the rounds disagree: try again in a quiet room'
  useListen.setState({ echo: { status: ok ? 'done' : 'failed', rounds, ...(ok ? {} : { message }) } })
}

/** Forgets the stored round trip (anchors fall back to the played time). */
export function clearEcho(): void {
  setMicRoundTrip(null)
  useListen.setState({ echo: { status: 'idle', rounds: [] } })
}
