// App shell: five tabs (D-12). Stand, Tracks (M4 slice) and Settings work; Map and Coach arrive in M8.
// In landscape the Stand tab fills the screen with the lead sheet (M5).
import { type Tab, TABS, useSession } from '../services'
import { TabIcon } from './atoms'
import { SettingsTab } from './settings/Settings'
import { useLandscape } from './stand/live'
import { Stand } from './stand/Stand'
import { TracksTab } from './tracks/Tracks'

const LABEL: Record<Tab, string> = { stand: 'Stand', tracks: 'Tracks', map: 'Map', coach: 'Coach', settings: 'Settings' }

export function Shell() {
  const { tab, setTab } = useSession()
  // Held sideways, Stand is the full-screen lead sheet; turn the phone back for the tabs.
  const sheet = useLandscape() && tab === 'stand'
  return (
    <div className={`shell${sheet ? ' land' : ''}`}>
      <main className={`view view-${tab}`}>
        {tab === 'stand' && <Stand />}
        {tab === 'tracks' && <TracksTab />}
        {tab === 'map' && (
          <Later title="Song map" text="Every pass of the tune as a strip of bars, coloured by key, with a tap to jump and loop." />
        )}
        {tab === 'coach' && (
          <Later
            title="Scale coach"
            text="The next eight changes with a scale for each under the Inside, Bebop and Colour lenses, and ii–V–I guide-tone tips."
          />
        )}
        {tab === 'settings' && <SettingsTab />}
      </main>
      <nav className="tabs" aria-label="App tabs" hidden={sheet}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={t === tab ? 'on' : ''}
            aria-current={t === tab ? 'page' : undefined}
            onClick={() => setTab(t)}
          >
            <TabIcon tab={t} />
            {LABEL[t]}
          </button>
        ))}
      </nav>
    </div>
  )
}

function Later({ title, text }: { title: string; text: string }) {
  return (
    <div className="page">
      <h1 className="page-h">{title}</h1>
      <div className="empty">
        <span className="ch">
          <span className="r">Soon</span>
        </span>
        <p>{text}</p>
      </div>
    </div>
  )
}
