// Tracks tab, M4 slice: "Recorded" timelines to practise with on the manual clock. Backing tracks
// (Generated, On Spotify, Drills; D-12) arrive in M6.
import type { Timeline } from '@mq/model'
import { note, pc } from '@mq/theory'
import { useEffect, useState } from 'react'
import { useSession } from '../../services'
import { idbGet } from '../../store/idb'
import { useSettings } from '../../store/settings'
import { DEMO_ID, type TrackMeta, demoTimeline, parseTrackRef, recordedList } from '../../timeline/library'
import { Acc } from '../atoms'
import { homeKey } from '../stand/view'

interface Row extends TrackMeta {
  timeline: Timeline | null
}

/** Circle-of-fifths hue for a key swatch (the sketch's fifthsHue). */
const fifthsHue = (tonic: string): number => ((pc(note(tonic)) * 7) % 12) * 30 + 25

export function TracksTab() {
  const { id: openId, open, setTab } = useSession()
  const inst = useSettings((s) => s.instrument)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [ref, setRef] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = () =>
    void recordedList().then(async (list) =>
      setRows(
        await Promise.all(
          list.map(async (m) => ({
            ...m,
            timeline: m.id === DEMO_ID ? demoTimeline() : ((await idbGet<Timeline>('timelines', m.id)) ?? null),
          })),
        ),
      ),
    )
  useEffect(refresh, [])

  const go = async (id: string) => {
    setBusy(id)
    setMsg('')
    const r = await open(id)
    setBusy(null)
    if (r.status === 'ok') {
      refresh()
      setTab('stand')
    } else
      setMsg(
        r.status === 'missing'
          ? 'That track hasn’t been analysed yet. Run the companion on the PC first.'
          : `Couldn’t open it: ${r.message}`,
      )
  }

  return (
    <div className="page">
      <h1 className="page-h">Tracks</h1>
      <p className="tnote">
        Recorded timelines play on the app’s own clock. Use the play button and the slider on Stand. Backing tracks come
        later.
      </p>
      <div className="tlist" role="list">
        {rows?.map((r) => {
          const k = r.timeline ? homeKey(r.timeline, inst) : null
          return (
            <button
              type="button"
              role="listitem"
              key={r.id}
              className={`trow${r.id === openId ? ' on' : ''}`}
              onClick={() => void go(r.id)}
              disabled={busy !== null}
            >
              <span className="tkey" style={{ ['--h' as string]: k ? fifthsHue(k.tonic) : 0 }}>
                {k ? <Acc text={k.tonic} /> : '?'}
                <small>{k ? k.mode : ''}</small>
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="tt">{r.title}</span>
                <span className="tm">{r.artist ?? r.id}</span>
              </span>
              {busy === r.id ? (
                <span className="src pred">Opening…</span>
              ) : r.timeline ? (
                <span className="src exact">{r.timeline.source === 'exact' ? 'Exact' : 'Analysed'}</span>
              ) : (
                <span className="src pred">Download</span>
              )}
            </button>
          )
        })}
      </div>
      <form
        className="addref"
        onSubmit={(e) => {
          e.preventDefault()
          const id = parseTrackRef(ref)
          if (!id) return setMsg('Paste a Spotify track link, URI or ID.')
          void go(id)
        }}
      >
        <label className="lbl" htmlFor="ref">
          Open an analysed Spotify track
        </label>
        <div className="addref-row">
          <input
            id="ref"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="open.spotify.com/track/…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button type="submit" disabled={busy !== null}>
            Open
          </button>
        </div>
      </form>
      {msg && <p className="tmsg">{msg}</p>}
    </div>
  )
}
