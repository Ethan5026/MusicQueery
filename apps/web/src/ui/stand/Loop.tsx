// A–B loop on Stand (M6): tap once on the first bar to loop, again on the last; tap a third time to stop looping.
// Loops snap to bar lines. The band loops exactly; Spotify jumps back with a seek sent just before the end
// (services.ts learns how early); a recorded timeline loops on the manual clock.
import type { Timeline } from '@mq/model'
import { activeTransport, useLoop } from '../../services'
import { barIndexAt, barPosition } from './view'

const barEnd = (tl: Timeline, i: number): number => tl.bars[i + 1]?.startMs ?? tl.durationMs

export function LoopButton({ tl }: { tl: Timeline }) {
  const { loop, pendingStart, set, setPending } = useLoop()
  if (tl.bars.length === 0) return null
  const tap = () => {
    if (loop) return set(null)
    const pos = activeTransport().clock.positionMs()
    const i = Math.max(0, barIndexAt(tl, pos))
    if (pendingStart === null) return setPending(tl.bars[i]!.startMs)
    const a = Math.max(0, barIndexAt(tl, pendingStart + 1))
    const [lo, hi] = i >= a ? [a, i] : [i, a]
    set({ startMs: tl.bars[lo]!.startMs, endMs: barEnd(tl, hi) })
  }
  let text = 'A–B'
  let label = 'Loop: set the first bar'
  if (pendingStart !== null) {
    text = 'A–…'
    label = 'Loop: set the last bar'
  } else if (loop) {
    const a = barPosition(tl, barIndexAt(tl, loop.startMs + 1))?.n
    const b = barPosition(tl, barIndexAt(tl, loop.endMs - 1))?.n
    text = a && b ? `${a}–${b} ✕` : 'Loop ✕'
    label = 'Stop looping'
  }
  return (
    <button
      type="button"
      className={`loopbtn${loop ? ' on' : pendingStart !== null ? ' pending' : ''}`}
      onClick={tap}
      aria-label={label}
      title={label}
      data-testid="loop"
    >
      {text}
    </button>
  )
}

/** The loop's span drawn on the progress bar. */
export function LoopBand({ durationMs }: { durationMs: number }) {
  const loop = useLoop((s) => s.loop)
  if (!loop || !durationMs) return null
  const left = (loop.startMs / durationMs) * 100
  const width = ((loop.endMs - loop.startMs) / durationMs) * 100
  return <b className="loopband" style={{ left: `${left}%`, width: `${width}%` }} />
}
