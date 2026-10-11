// Lead sheet (landscape, sketch "Lead sheet"): the chart four bars to a line with a brass playhead sweeping the
// current bar, scrolling a line at a time with the next line in view; tap a bar to seek there.
// The play panel on the right is a two-staff system, named in the margin like the staves of a score: Now, in full
// colour, and Next, the next point where the notes change, in muted ink with only the changing notes in rust and a
// countdown that turns rust in the last four beats. Same moment, Play mode and Staff/Keys setting as portrait.
import type { Timeline } from '@mq/model'
import { type Moment, analyseTimeline } from '@mq/theory'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { activeTransport } from '../../services'
import { type Settings, useSettings } from '../../store/settings'
import type { TrackMeta } from '../../timeline/library'
import { Acc, ChordSym, Seg } from '../atoms'
import { InstrumentSeg } from './InstrumentSeg'
import { Keyboard } from './Keyboard'
import { frameBus } from './live'
import { type NextResult, beatsUntil, nextChange } from './next'
import { type PlayView, playView } from './play'
import { type SheetBar, buildSheet, topRow } from './sheet'
import { LiveSyncBadge, PlayIcon } from './Stand'
import { Staff } from './Staff'
import { barIndexAt, barPosition, homeKey, keyText, sectionLabel, tempoAt } from './view'

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
  const pos = cur >= 0 ? barPosition(tl, cur) : null
  const where = sectionLabel(tl, cur) ?? (pos ? `Bar ${pos.n} of ${pos.total}` : 'Count-in')
  const t = activeTransport()

  return (
    <div className="lapp" data-testid="lead-sheet">
      <div className="sheet">
        <header className="sheet-h">
          <button type="button" className="lplay" aria-label={t.clock.playing ? 'Pause' : 'Play'} onClick={() => t.toggle()}>
            <PlayIcon playing={t.clock.playing} />
          </button>
          <div className="sheet-id">
            <span className="t">{meta.title}</span>
            <span className="sub">
              <span className="where">{where}</span>
              {home && (
                <span>
                  Home <b>
                    <Acc text={keyText(home)} />
                  </b>
                </span>
              )}
              {bpm !== null && (
                <span>
                  <b className="mono">{bpm}</b> bpm
                </span>
              )}
            </span>
          </div>
          <LiveSyncBadge />
        </header>
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
      <PlayPanel tl={tl} m={m} settings={settings} />
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

// Next is the same for every beat of a chord: computed once per chord, mode and instrument.
const nextCache = new WeakMap<Timeline, Map<string, NextResult>>()
function cachedNext(tl: Timeline, m: Moment, s: Settings): NextResult {
  let byKey = nextCache.get(tl)
  if (!byKey) nextCache.set(tl, (byKey = new Map()))
  const key = `${m.eventIndex}|${s.mode}|${s.instrument}|${s.lens}`
  let r = byKey.get(key)
  if (!r) {
    r = nextChange(tl, m, s.mode, { instrument: s.instrument, lens: s.lens })
    byKey.set(key, r)
  }
  return r
}

function PlayPanel({ tl, m, settings }: { tl: Timeline; m: Moment; settings: Settings }) {
  const set = useSettings((s) => s.set)
  const now = playView(m, settings.mode, { preview: false })
  const showNext = settings.nextScale
  const res = showNext ? cachedNext(tl, m, settings) : null
  const then = m.next[0]
  const big = !showNext
  const outside = now?.callout?.kind === 'outside' ? now.callout.changed : []

  return (
    <aside className="pp" aria-label="What to play">
      <div className="pp-ctl">
        <Seg
          mini
          name="lmode"
          label="Suggestions"
          value={settings.mode}
          options={[
            ['simple', 'Simple'],
            ['integrated', 'Integrated'],
            ['advanced', 'Advanced'],
          ]}
          onChange={(mode) => set({ mode })}
        />
        <Seg
          mini
          name="lnview"
          label="Show notes as"
          value={settings.notes}
          options={[
            ['staff', 'Staff'],
            ['keys', 'Keys'],
          ]}
          onChange={(notes) => set({ notes })}
        />
      </div>

      <div className="pp-now">
        <div className="pp-chord" data-testid="rail-chord">
          <ChordSym chord={m.chord} className="big" />
        </div>
        <div className="pp-meta">
          <span className="pp-fn">
            {m.fn && m.key ? (
              <>
                <b>
                  <Acc text={m.fn.text} />
                </b>{' '}
                in <Acc text={keyText(m.key)} />
              </>
            ) : null}
          </span>
          <div className="beats" aria-label={`Beat ${m.beatInBar + 1}`}>
            {Array.from({ length: Math.min(tl.meter.num, 6) }, (_, i) => (
              <i key={i} className={(i === 0 ? 'one' : '') + (i === m.beatInBar && m.bar ? ' on' : '')} />
            ))}
          </div>
          <span className="pp-then">
            {then ? (
              <>
                then <ChordSym chord={then.chord} /> in {then.inBeats}
              </>
            ) : (
              'end'
            )}
          </span>
        </div>
      </div>

      <div className={`system${showNext ? '' : ' solo'}`}>
        <section className="sys-row sys-now" aria-label="Now">
          <span className="sys-name">Now</span>
          <div className="sys-body">
            <div className="sys-h">
              {now ? (
                <b className="sys-title" data-testid="now-scale">
                  <Acc text={now.title} />
                </b>
              ) : (
                <b className="sys-title quiet">No chord</b>
              )}
              {outside.length > 0 && (
                <span className="sys-alt">
                  with{' '}
                  {outside.map((n) => (
                    <b key={n}>
                      <Acc text={n} />
                    </b>
                  ))}
                </span>
              )}
              <InstrumentSeg name="linst" />
            </div>
            {now && <Notes view={now} kind={settings.notes} big={big} />}
          </div>
        </section>

        {showNext && res && <NextRow tl={tl} m={m} res={res} kind={settings.notes} />}
      </div>
    </aside>
  )
}

function NextRow({ tl, m, res, kind }: { tl: Timeline; m: Moment; res: NextResult; kind: Settings['notes'] }) {
  const nx = res.next
  if (!nx) {
    const ev = analyseTimeline(tl).events
    const lastEv = ev[res.lastEventIndex]
    const atEnd = res.lastEventIndex >= ev.length - 1
    const bar = lastEv ? barPosition(tl, barIndexAt(tl, lastEv.endMs - 1)) : null
    return (
      <section className="sys-row sys-next none" aria-label="Next">
        <span className="sys-name">Next</span>
        <p className="sys-same" data-testid="next-scale">
          {atEnd ? 'Same notes to the end.' : `Same notes through bar ${bar?.n ?? '…'}.`}
        </p>
      </section>
    )
  }
  const n = beatsUntil(nx.startBeat, m.beat)
  const soon = n <= 4
  return (
    <section className={`sys-row sys-next${soon ? ' soon' : ''}`} aria-label="Next">
      <span className="sys-name">Next</span>
      <div className="sys-body">
        <div className="sys-h">
          <b className="sys-title" data-testid="next-scale">
            <Acc text={nx.view.title} />
          </b>
          <span className="sys-when">
            in <b className="mono">{n}</b> {n === 1 ? 'beat' : 'beats'}, on <ChordSym chord={nx.chord} />
          </span>
        </div>
        <span className="sys-meter" aria-hidden="true">
          <i style={{ width: `${Math.max(4, (1 - Math.min(n, 16) / 16) * 100)}%` }} />
        </span>
        <Notes view={nx.view} kind={kind} big={false} />
      </div>
    </section>
  )
}

/** One staff (or keyboard) of the system. Both rows share a size so their notes line up for comparison. */
function Notes({ view, kind, big }: { view: PlayView; kind: Settings['notes']; big: boolean }) {
  return kind === 'staff' ? (
    <div className="staffbox">
      {/* The panel is width-bound: bigger noteheads come from a larger staff space with tighter note spacing. */}
      <Staff chord={view.chord} notes={view.notes} s={big ? 11 : 8.5} g={big ? 31 : 29} octave names />
    </div>
  ) : (
    <div className="kb">
      <Keyboard notes={view.notes} w={320} h={big ? 112 : 80} />
    </div>
  )
}
