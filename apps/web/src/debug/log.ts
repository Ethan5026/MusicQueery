// Remote log (no Web Inspector without a Mac): every line goes to the console, a ring buffer
// for the on-screen panel, and in batches to the Worker's /log, where `wrangler tail` shows it.

import { API_URL } from '../config'

export type Level = 'debug' | 'info' | 'warn' | 'error'

export interface LogLine {
  /** Wall clock (ms). */
  t: number
  /** performance.now() (ms). */
  p: number
  l: Level
  m: string
  d?: unknown
}

export const session = Math.random().toString(36).slice(2, 8)
export const recent: LogLine[] = []
export const remote = { sent: 0, failed: 0, lastError: '' }

const listeners = new Set<() => void>()
let queue: LogLine[] = []

export function onLog(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function log(l: Level, m: string, d?: unknown): void {
  const line: LogLine = { t: Date.now(), p: Math.round(performance.now()), l, m, ...(d === undefined ? {} : { d }) }
  const fn = l === 'debug' ? console.debug : l === 'info' ? console.info : l === 'warn' ? console.warn : console.error
  fn(`[${m}]`, d ?? '')
  recent.push(line)
  if (recent.length > 300) recent.shift()
  queue.push(line)
  if (queue.length > 500) queue = queue.slice(-500)
  for (const cb of listeners) cb()
}

export async function flush(): Promise<void> {
  if (!API_URL || queue.length === 0) return
  const lines = queue
  queue = []
  try {
    // text/plain keeps this a simple request (no CORS preflight).
    const res = await fetch(`${API_URL}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ session, lines }),
      keepalive: true,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    remote.sent += lines.length
  } catch (err) {
    remote.failed += lines.length
    remote.lastError = String(err)
    queue = [...lines, ...queue].slice(-500)
  }
}

export function startRemoteLog(): void {
  setInterval(() => void flush(), 5000)
  document.addEventListener('visibilitychange', () => {
    log('info', 'visibility', { state: document.visibilityState })
    if (document.visibilityState === 'hidden') void flush()
  })
  addEventListener('error', (e) => log('error', 'window.error', { msg: e.message, src: `${e.filename}:${e.lineno}` }))
  addEventListener('unhandledrejection', (e) => log('error', 'unhandledrejection', { reason: String(e.reason) }))
}
