// ManualClock (D-16): the app's own transport for a recorded timeline (M4). Play, pause and seek by hand;
// position runs on performance.now() and stops at the end of the track.
import type { Clock, JumpEvent, JumpKind } from './types'

export class ManualClock implements Clock {
  trackId: string | null = null
  durationMs = 0
  private originMs = 0
  private originAt = 0
  private _playing = false
  private subs = new Set<(e: JumpEvent) => void>()

  constructor(private now: () => number = () => performance.now()) {}

  get playing(): boolean {
    return this._playing
  }

  positionMs(at: number = this.now()): number {
    const p = this._playing ? this.originMs + (at - this.originAt) : this.originMs
    return Math.min(this.durationMs, Math.max(0, p))
  }

  onJump(cb: (e: JumpEvent) => void): () => void {
    this.subs.add(cb)
    return () => this.subs.delete(cb)
  }

  /** Loads a track paused at `startMs`. */
  load(trackId: string, durationMs: number, startMs = 0): void {
    const from = this.positionMs()
    this.trackId = trackId
    this.durationMs = durationMs
    this._playing = false
    this.anchor(startMs)
    this.emit('track', from)
  }

  play(): void {
    if (this._playing || !this.trackId) return
    const from = this.positionMs()
    // Play from the end starts over.
    this.anchor(from >= this.durationMs ? 0 : from)
    this._playing = true
    this.emit('play', from)
  }

  pause(): void {
    if (!this._playing) return
    const from = this.positionMs()
    this.anchor(from)
    this._playing = false
    this.emit('pause', from)
  }

  toggle(): void {
    if (this._playing) this.pause()
    else this.play()
  }

  seek(ms: number): void {
    const from = this.positionMs()
    this.anchor(ms)
    this.emit('seek', from)
  }

  /** Call from the frame loop: pauses at the end of the track. Returns true when it stopped. */
  checkEnd(): boolean {
    if (this._playing && this.positionMs() >= this.durationMs) {
      this.pause()
      return true
    }
    return false
  }

  private anchor(ms: number): void {
    this.originMs = Math.min(this.durationMs, Math.max(0, ms))
    this.originAt = this.now()
  }

  private emit(kind: JumpKind, fromMs: number): void {
    const e: JumpEvent = { at: this.now(), kind, fromMs, toMs: this.positionMs(), trackId: this.trackId }
    for (const cb of this.subs) cb(e)
  }
}
