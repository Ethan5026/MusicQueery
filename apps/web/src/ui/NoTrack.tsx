// Empty state for the Map and Coach tabs (M8): they show whatever Stand has open, so say why there is nothing.
import { useSession } from '../services'

export function NoTrack({ title }: { title: string }) {
  const { setTab, driver, meta, status } = useSession()
  let text = 'Nothing is open. Play an analysed song on Spotify, or open a song or backing track in Tracks.'
  let go: 'stand' | 'tracks' = 'tracks'
  if (status === 'loading') text = 'Opening…'
  else if (driver === 'spotify' && meta) {
    text = `${meta.title} has no chords yet. On Stand you can queue it for the PC or listen with the mic.`
    go = 'stand'
  }
  return (
    <div className="page">
      <h1 className="page-h">{title}</h1>
      <div className="empty" data-testid="no-track">
        <p>{text}</p>
        {status !== 'loading' && (
          <button type="button" className="btn" onClick={() => setTab(go)}>
            {go === 'stand' ? 'Open Stand' : 'Open Tracks'}
          </button>
        )}
      </div>
    </div>
  )
}
