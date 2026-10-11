// Settings that change the chart (sketch "Settings" card): instrument, lens, Staff/Keys, theme.
// Kept in IndexedDB; loaded before the first render so the theme never flashes.
import type { InstrumentId, Lens } from '@mq/theory'
import { create } from 'zustand'
import { idbGet, idbSet } from './idb'

export type NotesView = 'staff' | 'keys'
/** Stage = dark (default, for gigs), Paper = light, Auto follows the phone. */
export type Theme = 'stage' | 'paper' | 'auto'

export interface Settings {
  instrument: InstrumentId
  lens: Lens
  notes: NotesView
  theme: Theme
}

export const DEFAULT_SETTINGS: Settings = { instrument: 'concert', lens: 'inside', notes: 'staff', theme: 'stage' }

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  set: (patch) => {
    set(patch)
    const { instrument, lens, notes, theme } = get()
    applyTheme(theme)
    void idbSet('settings', 'prefs', { instrument, lens, notes, theme })
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
