// M4 exit check "no task > 50 ms over 2 min on the iPhone". Safari has no Long Tasks API, so the main signal is
// the gap between animation frames (a 50 ms task shows as a gap of ≥ 50 ms); long tasks are counted too where
// the browser reports them. A summary goes to the remote log every 30 s while the page is visible.
import { log } from './debug/log'

export interface PerfWindow {
  sinceMs: number
  frames: number
  maxGapMs: number
  /** frames that took longer than 50 ms */
  over50: number
  longTasks: number
  maxLongTaskMs: number
  /** time spent in moment() per update */
  maxWorkMs: number
}

const fresh = (now: number): PerfWindow => ({ sinceMs: now, frames: 0, maxGapMs: 0, over50: 0, longTasks: 0, maxLongTaskMs: 0, maxWorkMs: 0 })

class Perf {
  /** since start or the last reset */
  total = fresh(0)
  private win = fresh(0)
  private last = 0
  private subs = new Set<() => void>()

  start(): void {
    const now = performance.now()
    this.total = fresh(now)
    this.win = fresh(now)
    const frame = (t: number) => {
      if (this.last) {
        const gap = t - this.last
        for (const w of [this.total, this.win]) {
          w.frames++
          if (gap > w.maxGapMs) w.maxGapMs = gap
          if (gap > 50) w.over50++
        }
      }
      this.last = t
      if (t - this.win.sinceMs >= 30_000) this.report(t)
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    document.addEventListener('visibilitychange', () => {
      // Hidden pages get no frames; don't count the pause as a gap.
      this.last = 0
      if (document.visibilityState === 'hidden') this.report(performance.now())
    })
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          for (const w of [this.total, this.win]) {
            w.longTasks++
            w.maxLongTaskMs = Math.max(w.maxLongTaskMs, e.duration)
          }
      }).observe({ type: 'longtask', buffered: false })
    } catch {
      // not supported (Safari)
    }
  }

  work(ms: number): void {
    for (const w of [this.total, this.win]) w.maxWorkMs = Math.max(w.maxWorkMs, ms)
  }

  reset(): void {
    const now = performance.now()
    this.total = fresh(now)
    this.win = fresh(now)
    this.last = 0
    for (const cb of this.subs) cb()
  }

  subscribe(cb: () => void): () => void {
    this.subs.add(cb)
    return () => this.subs.delete(cb)
  }

  private report(now: number): void {
    const w = this.win
    if (w.frames > 0)
      log('info', 'perf.window', {
        s: Math.round((now - w.sinceMs) / 1000),
        frames: w.frames,
        maxGapMs: Math.round(w.maxGapMs),
        over50: w.over50,
        longTasks: w.longTasks,
        maxWorkMs: Math.round(w.maxWorkMs * 10) / 10,
        totalS: Math.round((now - this.total.sinceMs) / 1000),
        totalOver50: this.total.over50,
        totalMaxGapMs: Math.round(this.total.maxGapMs),
      })
    this.win = fresh(now)
    for (const cb of this.subs) cb()
  }
}

export const perf = new Perf()
