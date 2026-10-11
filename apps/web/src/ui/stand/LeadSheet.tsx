// Lead sheet (landscape, sketch "Lead sheet"): the chart four bars to a line with a brass playhead sweeping the
// current bar, scrolling a line at a time with the next line in view; tap a bar to seek there. The rail on the
// right keeps the current chord, next chord and scale in fixed places. Same moment and settings as portrait.
import type { Timeline } from '@mq/model'
import type { Moment } from '@mq/theory'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { activeTransport } from '../../services'
import type { Settings } from '../../store/settings'
import type { TrackMeta } from '../../timeline/library'
import { Acc, ChordSym } from '../atoms'
import { Keyboard } from './Keyboard'
import { frameBus } from './live'
import { playView } from './play'
import { type SheetBar, buildSheet, topRow } from './sheet'
import { LiveSyncBadge, PlayIcon } from './Stand'
import { Staff } from './Staff'
import { barPosition, homeKey, keyText, sectionLabel, tempoAt } from './view'

/** Lines in view at once. */
const VISIBLE = 4

export function LeadSheet({ tl, meta, m, settings }: { tl: Timeline; meta: TrackMeta; m: Moment; settings: Settings }) {
  const inst = settings.instrument
  const sheet = useMemo(() => buildSheet(tl, inst), [tl, inst])
  const win = useRef<HTMLDivElement>(null)
  const [rowH, setRowH] = useState(78)
  useLayoutEffect(() => {
    const el = win.current
    if (!el) return
    const fit = () => setRowH(Math.max(48, Math.floor(el.clientHeight / VISIBLE)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cur = m.barIndex
  const row = cur >= 0 ? (sheet.rowOf[cur] ?? 0) : 0
  const top = topRow(row, sheet.rows.length, VISIBLE)

  // The playhead sweeps the current bar every frame (D-44: no React work per frame).
  const curBar = cur >= 0 ? tl.bars[cur] : undefined
  const span = useMemo(() => {
    const b = sheet.rows[row]?.find((x) => x.index === cur)
    return b ? { s: b.startMs, e: b.endMs } : null
  }, [sheet, row, cur])
  useEffect(() => {
    let el: HTMLElement | null = null
    const f = (pos: number) => {
      el ??= win.current?.querySelector<HTMLElement>('.lb.cur .ph') ?? null
      if (el && span) el.style.left = `${Math.min(100, Math.max(0, ((pos - span.s) / (span.e - span.s)) * 100)).toFixed(2)}%`
    }
    frameBus.add(f)
    return () => void frameBus.delete(f)
  }, [span])

  const home = homeKey(tl, inst)
  const bpm = tempoAt(tl, m.positionMs)
  const where = sectionLabel(tl, m.barIndex) ?? (curBar ? `Bar ${barPosition(tl, cur)?.n} / ${barPosition(tl, cur)?.total}` : 'Intro')
  const t = activeTransport()

  return (
    <div className="lapp" data-testid="lead-sheet">
      <div className="sheet">
        <div className="sheet-h">
          <button type="button" className="lplay" aria-label={t.clock.playing ? 'Pause' : 'Play'} onClick={() => t.toggle()}>
            <PlayIcon playing={t.clock.playing} />
          </button>
          <span className="t">{meta.title}</span>
          <span className="lbl">{where}</span>
          <span className="sp" />
          {home && (
            <span className="chip">
              <em>Home</em>
              <b>
                <Acc text={keyText(home)} />
              </b>
            </span>
          )}
          {bpm !== null && (
            <span className="chip">
              <b className="mono">{bpm}</b>
              <em>BPM</em>
            </span>
          )}
          <LiveSyncBadge />
        </div>
        <div className="rows-win" ref={win}>
          <div className="rows" style={{ transform: `translateY(${-top * rowH}px)` }}>
            {sheet.rows.map((r, ri) => (
              <div className="lrow" key={ri} style={{ height: rowH }}>
                {r.map((b) => (
                  <Bar key={b.index} bar={b} state={b.index === cur ? 'cur' : b.index < cur ? 'past' : ''} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <Rail m={m} settings={settings} />
    </div>
  )
}

const Bar = memo(function Bar({ bar, state }: { bar: SheetBar; state: '' | 'cur' | 'past' }) {
  const n = bar.chords.length
  const size = n <= 1 ? '' : n === 2 ? ' split' : ' split3'
  return (
    <button
      type="button"
      className={`lb${size}${bar.end ? ' end' : ''}${state ? ' ' + state : ''}`}
      aria-label={`Bar ${bar.n}: ${bar.chords.map((c) => c.chord.symbol).join(', ') || 'no chord'}`}
      aria-current={state === 'cur' ? 'true' : undefined}
      data-bar={bar.index}
      onClick={() => activeTransport().seek(bar.startMs + 1)}
    >
      {bar.reh && <span className="reh">{bar.reh}</span>}
      {bar.kmark && (
        <span className={`kmark${bar.kmark.home ? ' home' : ''}`}>
          <Acc text={bar.kmark.text} />
        </span>
      )}
      {bar.lead > 0.05 && <span className="cell" style={{ flexGrow: bar.lead }} />}
      {bar.chords.map((c, i) => (
        <span key={i} className={`cell${c.held ? ' held' : ''}`} style={{ flexGrow: Math.max(c.share, 0.15) }}>
          <ChordSym chord={c.chord} />
        </span>
      ))}
      <span className="num">{bar.n}</span>
      {state === 'cur' && <span className="ph" />}
    </button>
  )
})

function Rail({ m, settings }: { m: Moment; settings: Settings }) {
  const view = playView(m, settings.mode)
  const next = m.next[0]
  return (
    <aside className="rail" aria-label="Now">
      <div className="row">
        <span className="lbl">Now</span>
        {m.key && (
          <span className="chip now">
            <b>
              <Acc text={keyText(m.key)} />
            </b>
          </span>
        )}
      </div>
      <div className="rail-chord" data-testid="rail-chord">
        <ChordSym chord={m.chord} className="big" />
      </div>
      <div className="row">
        <span className="fn">{m.fn ? <Acc text={m.fn.text} /> : null}</span>
        <div className="beats" aria-label={`Beat ${m.beatInBar + 1}`}>
          {Array.from({ length: 4 }, (_, i) => (
            <i key={i} className={(i === 0 ? 'one' : '') + (i === m.beatInBar && m.bar ? ' on' : '')} />
          ))}
        </div>
      </div>
      <div className="nx">
        {next ? (
          <>
            <span className="lbl">Next</span>
            <ChordSym chord={next.chord} />
            <span className="mono">in {next.inBeats === 1 ? '1 beat' : `${next.inBeats} beats`}</span>
          </>
        ) : (
          <span className="lbl">End</span>
        )}
      </div>
      {view && (
        <>
          <span className="sc">
            <Acc text={view.title} />
          </span>
          {settings.notes === 'staff' ? (
            <div className="staffbox">
              <Staff chord={view.chord} notes={view.notes} s={6} g={view.chord ? 18 : 24} octave={false} names={false} />
            </div>
          ) : (
            <div className="kb">
              <Keyboard notes={view.notes} w={234} h={64} />
            </div>
          )}
          {view.callout && (
            <span className={`rail-callout ${view.callout.kind}`}>
              <Acc text={view.callout.lead} />
            </span>
          )}
        </>
      )}
    </aside>
  )
}
