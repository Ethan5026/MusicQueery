// The app's one AudioContext (M6, SP5). iOS needs it created or resumed inside a tap, and plays Web Audio through
// the ringer channel (muted by the silent switch) unless the page declares a playback audio session first
// (`navigator.audioSession.type = 'playback'`, Safari 16.4+), so `unlock()` does both from the Play button.
import { log } from '../debug/log'

interface AudioSessionLike {
  type: string
}

let ctx: AudioContext | null = null
export type LatencyHint = 'interactive' | 'playback' | 'balanced'
let hint: LatencyHint = 'playback'

/** For the SP5 audio test: the next context is created with this latency hint. */
export function setLatencyHint(h: LatencyHint): void {
  if (h === hint) return
  hint = h
  if (ctx) {
    void ctx.close()
    ctx = null
  }
}

export function audioContext(): AudioContext {
  ctx ??= new AudioContext({ latencyHint: hint })
  return ctx
}

export const hasAudioContext = (): boolean => ctx !== null

/** Call from a user gesture: declares playback (rings through the silent switch), resumes, and primes the output. */
export async function unlock(): Promise<AudioContext> {
  const session = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession
  if (session && session.type !== 'playback') {
    try {
      session.type = 'playback'
    } catch (err) {
      log('warn', 'audio.session_failed', { err: String(err) })
    }
  }
  const c = audioContext()
  // a silent buffer started inside the gesture wakes the output on older iOS
  const src = c.createBufferSource()
  src.buffer = c.createBuffer(1, 1, c.sampleRate)
  src.connect(c.destination)
  src.start()
  if (c.state !== 'running') await c.resume()
  return c
}

/** What the SP5 audio test reports about the output path. */
export function audioInfo(): Record<string, unknown> {
  const c = ctx
  const session = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession
  return {
    hint,
    state: c?.state ?? 'none',
    sampleRate: c?.sampleRate ?? null,
    baseLatencyMs: c ? Math.round(c.baseLatency * 1000 * 10) / 10 : null,
    outputLatencyMs: c && 'outputLatency' in c ? Math.round(c.outputLatency * 1000 * 10) / 10 : null,
    audioSession: session ? session.type : 'unsupported',
    outputTimestamp: c ? typeof c.getOutputTimestamp === 'function' : null,
  }
}
