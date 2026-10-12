// Song map tab (M8, sketch "Song map"): one row per pass (or per 16 bars of a recording), each bar coloured by its
// key on the circle of fifths; the playhead moves every frame through a ref (D-44). Tap a strip to jump to that
// bar, a row's name to jump to its start. Below: key areas, and a card that loops the section (or 8-bar phrase)
// under the playhead with the A–B loop Stand uses (M6).
import type { Timeline } from '@mq/model'
import type { Moment } from '@mq/theory'
import { type MouseEvent, memo, useEffect, useMemo, useRef, useState } from 'react'
import { activeTransport, useLoop, useSession } from '../../services'
import { useSettings } from '../../store/settings'
import { Acc } from '../atoms'
import { NoTrack } from '../NoTrack'
import { fmt } from '../stand/Stand'
import { frameBus, useMoment, useShown } from '../stand/live'
import { barIndexAt, barPosition } from '../stand/view'
import { type SongMap, buildMap, loopSpan } from './map'
import { chartText, shareText } from './share'

export function MapTab() {
  const shown = useShown()
  const settings = useSettings()
  const title = useSession((s) => s.meta?.title ?? null)
  const m = useMoment(shown, settings)
  if (!shown || !m) return <NoTrack title="Song map" />
  return <MapView tl={shown} m={m} title={title} />
}

function MapView({ tl, m, title }: { tl: Timeline; m: Moment; title: string | null }) {
  const inst = useSettings((s) => s.instrument)
  const map = useMemo(() => buildMap(tl, inst), [tl, inst])
  const cur = map.rowOf[m.barIndex] ?? -1
  const ticks = map.rows.find((r) => r.pass !== null)?.ticks ?? []
  // re-rendered when the playhead changes row, not every beat (D-44); the marker moves through a ref
  const rows = useMemo(() => {
    const seek = (ms: number) => activeTransport().seek(ms + 1)
    return (
      <div className="mrows" data-testid="map-rows">
        {map.rows.map((r, k) => (
          <div key={k} className={`mrow${k === cur ? ' on' : ''}`}>
            <button type="button" className="nm" onClick={() => seek(r.startMs)}>
              {r.name}
              {r.sub && <small>{r.sub}</small>}
            </button>
            <Strip map={map} row={k} current={k === cur} onSeek={seek} />
          </div>
        ))}
      </div>
    )
  }, [map, cur])
  return (
    <div className="page map">
      <div className="map-h">
        <span className="lbl">{[title, fmt(tl.durationMs)].filter(Boolean).join(' · ')}</span>
        <div className="map-t">
          <h1 className="page-h">Song map</h1>
          <ShareButton tl={tl} title={title ?? 'Chords'} />
        </div>
        <p className="map-legend">Colour shows the key, placed by the circle of fifths, so related keys look alike. Tap a bar to jump there.</p>
      </div>
      {ticks.length > 1 && (
        <div className="sec-ticks" aria-hidden="true">
          <span />
          <span className="tk">
            {ticks.map((t) => (
              <span key={t.at} style={{ left: `${(t.at / map.widest) * 100}%` }}>
                {t.label}
              </span>
            ))}
          </span>
        </div>
      )}
      {rows}
      <KeyAreas map={map} />
      <LoopCard tl={tl} map={map} barIndex={m.barIndex} />
    </div>
  )
}

function Strip({ map, row, current, onSeek }: { map: SongMap; row: number; current: boolean; onSeek: (ms: number) => void }) {
  const r = map.rows[row]!
  const mk = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!current) return
    const f = (pos: number) => {
      const el = mk.current
      if (!el) return
      let i = r.bars.length - 1
      while (i > 0 && r.bars[i]!.startMs > pos) i--
      const b = r.bars[i]!
      const into = Math.min(1, Math.max(0, (pos - b.startMs) / Math.max(1, b.endMs - b.startMs)))
      el.style.left = `calc(${(((i + into) / r.bars.length) * 100).toFixed(2)}% - 1px)`
    }
    frameBus.add(f)
    f(activeTransport().clock.positionMs())
    return () => void frameBus.delete(f)
  }, [current, r])
  const tap = (e: MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const i = Math.min(r.bars.length - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * r.bars.length)))
    onSeek(r.bars[i]!.startMs)
  }
  return (
    <span className="strip-w">
      <button
        type="button"
        className="strip"
        style={{ width: `${(r.bars.length / map.widest) * 100}%` }}
        onClick={tap}
        aria-label={`${r.name}: ${r.bars.length} bars`}
      >
        {r.bars.map((b) => (
          <i key={b.index} className={b.hue === null ? 'none' : undefined} style={b.hue === null ? undefined : { ['--h' as string]: b.hue }} />
        ))}
        {current && <span className="mk" ref={mk} data-testid="map-playhead" />}
      </button>
    </span>
  )
}

const KeyAreas = memo(function KeyAreas({ map }: { map: SongMap }) {
  if (map.keys.length === 0) return null
  const most = map.keys[0]!.bars
  return (
    <section className="card keys" aria-label="Key areas">
      <span className="lbl">Key areas {map.keysScope === 'chorus' ? 'in one chorus' : 'in the track'}</span>
      {map.keys.map((k) => (
        <div key={k.id} className="krow">
          <span className="sw" style={{ ['--h' as string]: k.hue }} />
          <span>
            <Acc text={k.name} />
            {k.home && <span className="lbl"> home</span>}
          </span>
          <span className="bar">
            <i style={{ width: `${(k.bars / most) * 100}%` }} />
          </span>
          <span className="mono">{k.bars} bars</span>
        </div>
      ))}
    </section>
  )
})

function LoopCard({ tl, map, barIndex }: { tl: Timeline; map: SongMap; barIndex: number }) {
  const { loop, set } = useLoop()
  const driver = useSession((s) => s.driver)
  const span = loopSpan(tl, map, Math.max(0, barIndex))
  const n = (i: number) => barPosition(tl, i)?.n ?? tl.bars[i]!.number
  if (loop) {
    const a = barIndexAt(tl, loop.startMs + 1)
    const b = barIndexAt(tl, loop.endMs - 1)
    return (
      <section className="card loopc">
        <span className="t">
          Looping bars {n(a)}–{n(b)}
        </span>
        <span className="s">Stand shows the loop on its progress bar. Stop to play on.</span>
        <button type="button" className="go" onClick={() => set(null)}>
          Stop
        </button>
      </section>
    )
  }
  if (!span) return null
  const row = map.rows[map.rowOf[span.from]!]!
  const how =
    driver === 'spotify' ? `Seeks Spotify back at the end of bar ${n(span.to)}.` : driver === 'audio' ? 'The band loops it exactly.' : 'Loops on the app’s clock.'
  return (
    <section className="card loopc">
      <span className="t">Loop {span.label.startsWith('bars') ? span.label : <Acc text={span.label} />}</span>
      <span className="s">
        Bars {n(span.from)}–{n(span.to)}
        {row.pass !== null ? ` of chorus ${row.pass}` : ''}. {how}
      </span>
      <button
        type="button"
        className="go"
        data-testid="map-loop"
        onClick={() => set({ startMs: tl.bars[span.from]!.startMs, endMs: tl.bars[span.to + 1]?.startMs ?? tl.durationMs })}
      >
        Loop
      </button>
    </section>
  )
}

const SHARED = { shared: 'Shared', copied: 'Copied', cancelled: '', failed: 'Couldn’t share' } as const

/** Export: the song as a plain-text lead sheet, in written pitch and the chord style, to the share sheet. */
function ShareButton({ tl, title }: { tl: Timeline; title: string }) {
  const { instrument, chords } = useSettings()
  const [done, setDone] = useState('')
  const share = async () => {
    const r = await shareText(title, chartText(tl, instrument, title, chords))
    setDone(SHARED[r])
  }
  return (
    <button type="button" className="btn" onClick={() => void share()} data-testid="share-chords">
      {done || 'Share chords'}
    </button>
  )
}
