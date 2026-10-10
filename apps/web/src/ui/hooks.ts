import { useEffect, useReducer, useState } from 'react'

/** Re-render whenever `subscribe` fires. */
export function useSubscription(subscribe: ((cb: () => void) => () => void) | null): void {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => (subscribe ? subscribe(bump) : undefined), [subscribe])
}

/** Re-render every animation frame while `active`, returning performance.now(). */
export function useFrame(active = true): number {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!active) return
    let id = requestAnimationFrame(function tick(t) {
      setNow(t)
      id = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(id)
  }, [active])
  return now
}

export function fmtTime(ms: number): string {
  const sign = ms < 0 ? '-' : ''
  const a = Math.abs(ms)
  const m = Math.floor(a / 60_000)
  const s = Math.floor((a % 60_000) / 1000)
  const z = Math.floor(a % 1000)
  return `${sign}${m}:${String(s).padStart(2, '0')}.${String(z).padStart(3, '0')}`
}

export function fmtMs(ms: number | null | undefined, digits = 0): string {
  return ms === null || ms === undefined || Number.isNaN(ms) ? '–' : `${ms.toFixed(digits)} ms`
}
