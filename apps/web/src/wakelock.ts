// SP8: Screen Wake Lock in the standalone PWA. The lock is dropped whenever the page is hidden,
// so it is re-requested on return. Every transition is logged.

import { log } from './debug/log'

export type WakeState = 'unsupported' | 'off' | 'on' | 'error'

export class WakeLock {
  state: WakeState = 'wakeLock' in navigator ? 'off' : 'unsupported'
  events: string[] = []
  private sentinel: WakeLockSentinel | null = null
  private wanted = false
  private subs = new Set<() => void>()

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wanted && !this.sentinel) void this.acquire()
    })
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb)
    return () => this.subs.delete(cb)
  }

  private note(event: string, state: WakeState): void {
    this.state = state
    this.events.push(`${new Date().toLocaleTimeString()} ${event}`)
    if (this.events.length > 20) this.events.shift()
    log(state === 'error' ? 'warn' : 'info', 'wakelock', { event, state })
    for (const cb of this.subs) cb()
  }

  async enable(): Promise<void> {
    this.wanted = true
    await this.acquire()
  }

  async disable(): Promise<void> {
    this.wanted = false
    await this.sentinel?.release()
    this.sentinel = null
  }

  private async acquire(): Promise<void> {
    if (this.state === 'unsupported') return this.note('not supported', 'unsupported')
    try {
      const s = await navigator.wakeLock.request('screen')
      this.sentinel = s
      s.addEventListener('release', () => {
        this.sentinel = null
        this.note('released', 'off')
      })
      this.note('acquired', 'on')
    } catch (err) {
      this.note(`request failed: ${String(err)}`, 'error')
    }
  }
}

export const wakeLock = new WakeLock()
