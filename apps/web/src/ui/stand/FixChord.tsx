// Fix a chord (M7, `edits[]`): tap the chord on Stand, pick what it really is. The picker shows written pitch for the
// instrument in use and stores concert pitch. A fix covers this chord, or every chord with the same name in the song
// (a recogniser tends to make the same mistake each chorus). Fixes are kept per track and survive re-analysis.
import type { Timeline } from '@mq/model'
import { type Moment, analyseTimeline, chordToConcert, chordToWritten, formatChord, formatQuality, neutral, parseChord, pc } from '@mq/theory'
import { useMemo, useState } from 'react'
import { useSession } from '../../services'
import { useSettings } from '../../store/settings'
import { makeEdit } from '../../timeline/edits'
import { Acc } from '../atoms'
import { useStandUi } from './live'

const QUALITIES: [string, string][] = [
  ['', 'maj'],
  ['m', 'm'],
  ['7', '7'],
  ['maj7', 'maj7'],
  ['m7', 'm7'],
  ['m7♭5', 'ø7'],
  ['°', 'dim'],
  ['sus4', 'sus4'],
  ['6', '6'],
  ['m6', 'm6'],
  ['9', '9'],
]

export function FixChord({ tl, m }: { tl: Timeline; m: Moment }) {
  const close = () => useStandUi.getState().setFixing(false)
  const inst = useSettings((s) => s.instrument)
  const { edits, setEdits } = useSession()
  const events = useMemo(() => analyseTimeline(tl).events, [tl])
  const ev = events[m.eventIndex]
  const current = ev?.chord.kind === 'chord' ? chordToWritten(ev.chord, inst) : null
  const [root, setRoot] = useState<number | null>(current ? pc(current.root) : null)
  const [quality, setQuality] = useState<string>(() => {
    const q = current ? formatQuality(current) : ''
    return QUALITIES.some(([t]) => t === q) ? q : ''
  })
  const [nc, setNc] = useState(ev?.chord.kind === 'nc')
  const [all, setAll] = useState(false)
  if (!ev) return null
  const same = events.filter((e) => e.symbol === ev.symbol)
  const writtenText = nc || root === null ? 'N.C.' : noteText(root) + quality
  const concert = (() => {
    if (nc || root === null) return 'N.C.'
    const c = parseChord(noteText(root) + quality)
    return c ? formatChord(chordToConcert(c, inst)) : null
  })()
  const save = () => {
    if (!concert) return
    const spans = all ? same : [ev]
    setEdits([...edits, ...spans.map((e) => makeEdit(e.startMs, e.endMs, concert, e.symbol))])
    close()
  }
  return (
    <div className="cal-back" role="dialog" aria-label="Fix this chord" onClick={(e) => e.target === e.currentTarget && close()}>
      <section className="card cal fix">
        <div className="cal-h">
          <span className="cal-dev">
            Fix <Acc text={current ? formatChord(current) : 'N.C.'} />
          </span>
          <button type="button" className="btn" onClick={close}>
            Close
          </button>
        </div>
        <div className="fix-now ch" data-testid="fix-preview">
          <span className="r">
            <Acc text={writtenText} />
          </span>
        </div>
        <div className="fix-grid roots" role="group" aria-label="Root">
          {ROOT_NAMES.map((n, p) => (
            <button
              type="button"
              key={n}
              className="tog"
              aria-pressed={!nc && root === p}
              onClick={() => {
                setRoot(p)
                setNc(false)
              }}
            >
              <Acc text={n} />
            </button>
          ))}
        </div>
        <div className="fix-grid quals" role="group" aria-label="Quality">
          {QUALITIES.map(([t, label]) => (
            <button type="button" key={label} className="tog" aria-pressed={!nc && quality === t} onClick={() => (setQuality(t), setNc(false))}>
              <Acc text={label} />
            </button>
          ))}
          <button type="button" className="tog" aria-pressed={nc} onClick={() => setNc(true)}>
            N.C.
          </button>
        </div>
        {same.length > 1 && (
          <label className="fix-all">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Every <Acc text={formatChord(ev.chord.kind === 'chord' ? chordToWritten(ev.chord, inst) : ev.chord)} /> in this song ({same.length})
          </label>
        )}
        {ev && tl.id.startsWith('spotify:') && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              close()
              useStandUi.getState().setLinking(true)
            }}
          >
            Wrong all over? Link an iReal chart…
          </button>
        )}
        <div className="cal-res">
          {edits.length > 0 ? (
            <button type="button" className="btn" onClick={() => (setEdits([]), close())}>
              Undo all my fixes ({edits.length})
            </button>
          ) : (
            <span className="cal-hint">Fixes stay with this track, even after it is analysed again.</span>
          )}
          <button type="button" className="btn primary" disabled={!concert} onClick={save} data-testid="fix-save">
            Save
          </button>
        </div>
      </section>
    </div>
  )
}

const ROOT_NAMES = Array.from({ length: 12 }, (_, p) => noteText(p))

function noteText(p: number): string {
  const n = neutral(p)
  return 'CDEFGAB'[n.letter]! + (n.acc < 0 ? '♭' : n.acc > 0 ? '♯' : '')
}
