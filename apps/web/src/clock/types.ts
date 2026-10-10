// Every screen reads position from a Clock (D-16): SpotifyClock | AudioClock | ManualClock.

// 'resync': Spotify's `timestamp` changed with no user action: the playing device sent a fresh
// position report, often ~300 ms off the server's extrapolation after a start or seek (SP2).
export type JumpKind = 'lock' | 'seek' | 'track' | 'play' | 'pause' | 'resync' | 'idle'

export interface JumpEvent {
  /** performance.now() when the jump was detected. */
  at: number
  kind: JumpKind
  fromMs: number
  toMs: number
  trackId: string | null
}

export interface Clock {
  /** Track position (ms) audible at performance time `at` (default: now). */
  positionMs(at?: number): number
  readonly playing: boolean
  readonly trackId: string | null
  /** Seeks, skips, play/pause and the first lock. Returns an unsubscribe function. */
  onJump(cb: (e: JumpEvent) => void): () => void
}
