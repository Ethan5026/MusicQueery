// Scale coach tab (M8, sketch "Scale coach"): the next eight changes from the one sounding now, each with the scale
// under the lens (the same setting as Stand's), its function, and the 3rd to land on; a tip names the guide-tone
// line through the next ii–V–I. Re-rendered per beat through useMoment; tap a row to jump to that chord.
import type { Timeline } from '@mq/model'
import { LENSES, type Lens, type Moment } from '@mq/theory'
import { useMemo } from 'react'
import { activeTransport } from '../../services'
import { useSettings } from '../../store/settings'
import { Acc, ChordSym } from '../atoms'
import { NoTrack } from '../NoTrack'
import { useMoment, useShown } from '../stand/live'
import { type CoachTip, COACH_CHANGES, coachRows, coachTip, describeLine } from './plan'

const LENS_LABEL: Record<Lens, string> = { inside: 'Inside', bebop: 'Bebop', colour: 'Colour' }

export function CoachTab() {
  const shown = useShown()
  const settings = useSettings()
  const m = useMoment(shown, settings)
  if (!shown || !m) return <NoTrack title="Scale coach" />
  return <CoachView tl={shown} m={m} />
}

function CoachView({ tl, m }: { tl: Timeline; m: Moment }) {
  const { instrument, lens, set } = useSettings()
  const from = m.eventIndex >= 0 ? m.eventIndex : (m.next[0]?.eventIndex ?? Number.MAX_SAFE_INTEGER)
  const rows = useMemo(() => coachRows(tl, from, instrument, lens), [tl, from, instrument, lens])
  const tip = useMemo(() => coachTip(tl, from, instrument), [tl, from, instrument])
  const predicted = tl.source === 'live'
  return (
    <div className="page coach">
      <div className="map-h">
        <span className="lbl">
          Next {COACH_CHANGES} changes{rows[0]?.bar ? ` · from bar ${rows[0].bar}` : ''}
          {predicted ? ' · predicted' : ''}
        </span>
        <h1 className="page-h">Scale coach</h1>
      </div>
      <div className="lens" role="radiogroup" aria-label="Scale lens">
        {LENSES.map((l) => (
          <span key={l}>
            <input type="radio" name="coach-lens" id={`coach-lens-${l}`} checked={lens === l} onChange={() => set({ lens: l })} />
            <label htmlFor={`coach-lens-${l}`}>{LENS_LABEL[l]}</label>
          </span>
        ))}
      </div>
      <div className="card tip" data-testid="coach-tip">
        <Tip tip={tip} />
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          <p>No more changes to the end of the track.</p>
        </div>
      ) : (
        <div className="ctab" role="table" aria-label="Next changes">
          <div className="crow hd" role="row">
            <span>Bar</span>
            <span>Chord</span>
            <span>Play</span>
            <span className="c">Land</span>
          </div>
          {rows.map((r) => (
            <button
              type="button"
              role="row"
              key={r.eventIndex}
              className={`crow${r.eventIndex === m.eventIndex ? ' on' : ''}${predicted && r.eventIndex !== m.eventIndex ? ' pred' : ''}`}
              onClick={() => activeTransport().seek(r.startMs + 1)}
            >
              <span className="mono">{r.bar ?? ''}</span>
              <ChordSym chord={r.chord} />
              <span className="pl">
                <span className="scn">
                  <Acc text={`${r.scale.root} ${r.scale.name}`} />
                </span>
                <span className="fnn">
                  <Acc text={r.fn} />
                </span>
              </span>
              <span className="land">
                <Acc text={r.land} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Tip({ tip }: { tip: CoachTip }) {
  if (tip.kind === 'none') return <>No ii–V–I in the next few bars. Target the 3rd of each chord on beat one.</>
  const into = `${tip.target} ${tip.mode}`
  return (
    <>
      <b>
        <Acc text={`ii–${tip.sub ? '♭II' : 'V'}${tip.resolved ? '–I' : ''} into ${into}`} />
      </b>
      {tip.bar ? ` at bar ${tip.bar}` : ''}. Guide-tone line <Acc text={tip.line.join(' → ')} />: <Acc text={describeLine(tip.line)} />.
      {tip.resolved ? '' : ' It doesn’t resolve here, so lean on that last note.'}
    </>
  )
}
