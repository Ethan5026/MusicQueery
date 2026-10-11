// Tracks tab (sketch, Backing tracks): Songs (the inbox and timelines on this phone, M5b), then the three backing
// sources of D-12: Generated (the band plays a chart), Drills (all-keys progressions), On Spotify (play-alongs).
import { useState } from 'react'
import { Seg } from '../atoms'
import { DrillsPanel } from './Drills'
import { GeneratedPanel } from './Generated'
import { OnSpotifyPanel } from './OnSpotify'
import { SongsPanel } from './Songs'

type Source = 'songs' | 'gen' | 'drill' | 'spot'
const SOURCES: Array<[Source, string]> = [
  ['songs', 'Songs'],
  ['gen', 'Generated'],
  ['drill', 'Drills'],
  ['spot', 'On Spotify'],
]
const KEY = 'mq.tracks.source'

function saved(): Source {
  try {
    const v = localStorage.getItem(KEY) as Source | null
    return v && SOURCES.some(([s]) => s === v) ? v : 'songs'
  } catch {
    return 'songs'
  }
}

export function TracksTab() {
  const [src, setSrc] = useState<Source>(saved)
  const choose = (s: Source) => {
    setSrc(s)
    try {
      localStorage.setItem(KEY, s)
    } catch {
      // private mode
    }
  }
  return (
    <div className="page">
      <h1 className="page-h">Tracks</h1>
      <Seg name="tsrc" label="Track source" value={src} options={SOURCES} onChange={choose} />
      {src === 'songs' && <SongsPanel />}
      {src === 'gen' && <GeneratedPanel />}
      {src === 'drill' && <DrillsPanel />}
      {src === 'spot' && <OnSpotifyPanel />}
    </div>
  )
}
