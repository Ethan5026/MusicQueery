// Hooks that tie the Stand screens to the active clock (D-16): the moment, a per-frame bus for things that move
// every frame (progress bar, playhead), the sync badge state, and the phone's orientation.
import type { Timeline } from '@mq/model'
import { type Moment, analyseTimeline, moment } from '@mq/theory'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { type SyncState, sameSync, syncState } from '../../clock/sync'
import { perf } from '../../perf'
import { band } from '../../audio/engine'
import { type Driver, clock, manual, transportFor, useApp, useSession } from '../../services'
import type { Settings } from '../../store/settings'
import { withEdits } from '../../timeline/edits'

/** Per-frame listeners: position and duration in ms. Registered by refs, so React stays out of it (D-44). */
export const frameBus = new Set<(pos: number, dur: number) => void>()

/** The timeline Stand, Map and Coach show: while listening the live view, else a linked chart, else the open
 *  timeline; the player's chord fixes on top (M7). */
export function useShown(): Timeline | null {
  const { timeline, live, linked, edits } = useSession()
  return useMemo(() => {
    const base = live ?? linked?.timeline ?? timeline
    return base ? withEdits(base, edits) : null
  }, [live, linked, timeline, edits])
}

/** theory.moment() at the active clock, recomputed when the beat or the chord changes. */
export function useMoment(tl: Timeline | null, s: Settings): Moment | null {
  const [m, setM] = useState<Moment | null>(null)
  const driver = useSession((x) => x.driver)
  const { instrument, lens } = s
  useEffect(() => {
    if (!tl) return
    const t = transportFor(driver)
    const a = analyseTimeline(tl)
    const ev = a.events
    let raf = 0
    let last = ''
    const frame = () => {
      t.tick()
      const pos = t.clock.positionMs()
      const dur = t.durationMs() || tl.durationMs
      for (const f of frameBus) f(pos, dur)
      let i = -1
      for (let lo = 0, hi = ev.length - 1; lo <= hi; ) {
        const mid = (lo + hi) >> 1
        if (ev[mid]!.startMs <= pos) {
          i = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      const key = `${Math.floor(a.beatAt(pos) + 1e-6)}|${i}`
      if (key !== last) {
        last = key
        const t0 = performance.now()
        setM(moment(tl, pos, { instrument, lens }))
        perf.work(performance.now() - t0)
      }
      if (t.clock.playing) raf = requestAnimationFrame(frame)
    }
    frame()
    const off = t.clock.onJump(() => {
      cancelAnimationFrame(raf)
      last = ''
      frame()
    })
    return () => {
      cancelAnimationFrame(raf)
      off()
    }
  }, [tl, instrument, lens, driver])
  return tl ? m : null
}

function currentSync(driver: Driver, authed: boolean): SyncState {
  if (driver === 'manual') return { kind: 'manual', playing: manual.playing }
  if (driver === 'audio') return { kind: 'band', playing: band.playing, countIn: band.countInLeft() }
  return syncState({
    authed,
    now: performance.now(),
    failing: clock.lastError !== null,
    lastOkAt: clock.lastOkAt,
    locked: clock.locked,
    playing: clock.playing,
    quality: clock.quality(),
  })
}

/** The sync badge state, checked four times a second (ten for the band's count-in); re-renders only on a change. */
export function useSync(): SyncState {
  const driver = useSession((x) => x.driver)
  const authed = useApp((x) => x.authed)
  const [st, setSt] = useState<SyncState>(() => currentSync(driver, authed))
  useEffect(() => {
    const check = () => {
      const n = currentSync(driver, authed)
      setSt((p) => (sameSync(p, n) ? p : n))
    }
    check()
    const id = setInterval(check, driver === 'audio' ? 100 : 250)
    const off1 = clock.onJump(check)
    const off2 = manual.onJump(check)
    const off3 = band.onJump(check)
    return () => {
      clearInterval(id)
      off1()
      off2()
      off3()
    }
  }, [driver, authed])
  return st
}

const LANDSCAPE = '(orientation: landscape) and (max-height: 560px)'

const subscribeOrientation = (cb: () => void) => {
  const mq = matchMedia(LANDSCAPE)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/** A phone held sideways: Stand becomes the lead sheet. */
export const useLandscape = (): boolean => useSyncExternalStore(subscribeOrientation, () => matchMedia(LANDSCAPE).matches)

/** Screen-level UI state that outlives a rotation. */
export const useStandUi = create<{
  calibrating: boolean
  setCalibrating: (v: boolean) => void
  /** the fix-a-chord sheet (M7) */
  fixing: boolean
  setFixing: (v: boolean) => void
  /** the link-a-chart sheet (M7) */
  linking: boolean
  setLinking: (v: boolean) => void
}>((set) => ({
  calibrating: false,
  setCalibrating: (calibrating) => set({ calibrating }),
  fixing: false,
  setFixing: (fixing) => set({ fixing }),
  linking: false,
  setLinking: (linking) => set({ linking }),
}))
