// App-wide singletons. Screens read the clock; only the clock talks to Spotify (D-16).

import { create } from 'zustand'
import { SpotifyClock } from './clock/SpotifyClock'
import { offsetFor, startBiasStore } from './clock/offsets'
import { log } from './debug/log'
import { fetchPlayer } from './spotify/api'
import { loadTokens, sp1Record, type Sp1Record } from './spotify/auth'

export const clock = new SpotifyClock({
  fetchPlayer,
  offsetFor,
  startBias: startBiasStore,
  onError: (err) => log('warn', 'clock.poll_failed', { err: String(err) }),
})

clock.onJump((e) => log('info', 'clock.jump', e))

interface AppState {
  authed: boolean
  sp1: Sp1Record | null
  refreshAuth: () => void
}

export const useApp = create<AppState>((set) => ({
  authed: loadTokens() !== null,
  sp1: sp1Record(),
  refreshAuth: () => set({ authed: loadTokens() !== null, sp1: sp1Record() }),
}))

/** Poll only while logged in and visible (D-03: off when hidden). */
export function runClock(): void {
  const sync = () => {
    if (useApp.getState().authed && document.visibilityState === 'visible') clock.start()
    else clock.stop()
  }
  document.addEventListener('visibilitychange', sync)
  useApp.subscribe(sync)
  sync()
}
