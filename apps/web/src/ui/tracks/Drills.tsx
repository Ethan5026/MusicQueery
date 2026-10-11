// Tracks → Drills (D-12): progressions through every key, generated, so the chords are exact. The key on the band
// card is where the drill starts; it then moves round the circle of fifths.
import { DRILLS } from '../../audio/library'
import { drillSpec } from '../../audio/library'
import { useBackingPick } from './backing'
import { TrackRow } from './Songs'

const NOTE: Record<string, string> = { modal: 'modes', drone: 'drone' }

export function DrillsPanel() {
  const { pick, setPick, card, openRef } = useBackingPick(['drill'])
  return (
    <>
      <p className="tnote">Generated. Each drill moves you through every key; the key you pick is where it starts.</p>
      <div className="tlist" role="list">
        {DRILLS.map((d) => (
          <TrackRow
            key={d.id}
            id={d.id}
            title={d.title}
            sub={d.sub}
            concertKey={{ tonic: d.key, mode: d.mode }}
            {...(NOTE[d.id] ? { keyNote: NOTE[d.id] } : {})}
            on={pick?.spec.ref === d.id}
            disabled={false}
            onClick={() => {
              const spec = drillSpec(d.id)
              if (spec) setPick({ spec, mode: d.mode, title: d.title })
            }}
          >
            <span className="src exact">{openRef === d.id ? 'In Stand' : 'Exact'}</span>
          </TrackRow>
        ))}
      </div>
      {card && <div className="band-dock">{card}</div>}
    </>
  )
}
