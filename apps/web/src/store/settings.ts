// Settings that change the chart (sketch "Settings" card): instrument, lens, Staff/Keys, theme, chord style.
// Kept in IndexedDB; loaded before the first render so the theme never flashes.
import type { InstrumentId, Lens } from '@mq/theory'
import { create } from 'zustand'
import type { ChordStyle } from '../ui/chordStyle'
import type { PlayMode } from '../ui/stand/play'
import { idbGet, idbSet } from './idb'

export type NotesView = 'staff' | 'keys'
/** Stage = dark (default, for gigs), Paper = light, Auto follows the phone. */
export type Theme = 'stage' | 'paper' | 'auto'

export interface Settings {
  instrument: InstrumentId
  lens: Lens
  notes: NotesView
  theme: Theme
  /** Play card: key-centre scale (simple), plus callouts (integrated), or chord-scales (advanced) */
  mode: PlayMode
  /** landscape: a second staff with the next change of notes */
  nextScale: boolean
  /** chord qualities as text (maj7, m7) or symbols (Δ7, –7) */
  chords: ChordStyle
}

export const DEFAULT_SETTINGS: Settings = { instrument: 'concert', lens: 'inside', notes: 'staff', theme: 'stage', mode: 'integrated', nextScale: true, chords: 'text' }

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  set: (patch) => {
    set(patch)
    const { instrument, lens, notes, theme, mode, nextScale, chords } = get()
    applyTheme(theme)
    void idbSet('settings', 'prefs', { instrument, lens, notes, theme, mode, nextScale, chords })
  },
}))

export async function loadSettings(): Promise<void> {
  const saved = await idbGet<Partial<Settings>>('settings', 'prefs')
  const s = { ...DEFAULT_SETTINGS, ...saved }
  useSettings.setState(s)
  applyTheme(s.theme)
}

const THEME_COLOR = { dark: '#090c11', light: '#f7f8f3' }

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'auto') delete root.dataset.theme
  else root.dataset.theme = theme === 'stage' ? 'dark' : 'light'
  const dark = theme === 'stage' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light)
}
