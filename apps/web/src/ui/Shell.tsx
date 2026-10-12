// App shell: five tabs (D-12): Stand, Tracks, Map and Coach (M8), Settings.
// In landscape the Stand tab fills the screen with the lead sheet (M5).
import { type Tab, TABS, useSession } from '../services'
import { TabIcon } from './atoms'
import { Boundary } from './Boundary'
import { CoachTab } from './coach/Coach'
import { MapTab } from './map/SongMap'
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
        <Boundary key={tab} name={tab}>
          {tab === 'stand' && <Stand />}
          {tab === 'tracks' && <TracksTab />}
          {tab === 'map' && <MapTab />}
          {tab === 'coach' && <CoachTab />}
          {tab === 'settings' && <SettingsTab />}
        </Boundary>
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
