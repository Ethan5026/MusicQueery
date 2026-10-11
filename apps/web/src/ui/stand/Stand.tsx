// Stand (portrait): the sketch's main screen, read top to bottom in order of urgency. Everything comes from
// theory.moment() on the open timeline at the clock's position (D-16). React re-renders once per beat or
// chord change; the progress bar moves every frame through refs.
import type { Timeline } from '@mq/model'
import { type Moment, type MomentKey, INSTRUMENT_IDS, analyseTimeline, moment } from '@mq/theory'
import { useEffect, useMemo, useState } from 'react'
import { perf } from '../../perf'
import { manual, useSession } from '../../services'
import { type Settings, useSettings } from '../../store/settings'
import type { TrackMeta } from '../../timeline/library'
import { Acc, ChordSym, Seg, SourceBadge, SyncBadge } from '../atoms'
import { Keyboard } from './Keyboard'
import { type PlayView, playView } from './play'
import { Staff } from './Staff'
import { barIndexAt, barPosition, homeKey, keyText, sectionLabel, tempoAt } from './view'

const INSTRUMENT_SHORT = { concert: 'Concert', alto: 'E♭ alto', tenor: 'B♭ tenor' } as const

export function Stand() {
  const { timeline, meta, status } = useSession()
  const settings = useSettings()
  const m = useMoment(timeline, settings)
  if (!timeline || !meta || !m)
    return <div className="stand-empty">{status === 'loading' ? 'Opening…' : 'Pick a track in Tracks.'}</div>
  return <StandView tl={timeline} meta={meta} m={m} settings={settings} />
}

/** theory.moment() at the clock, recomputed when the beat or the chord changes. */
function useMoment(tl: Timeline | null, s: Settings): Moment | null {
  const [m, setM] = useState<Moment | null>(null)
  const { instrument, lens } = s
  useEffect(() => {
    if (!tl) return
    const a = analyseTimeline(tl)
    const ev = a.events
    let raf = 0
    let last = ''
    const frame = () => {
      manual.checkEnd()
      const pos = manual.positionMs()
      progress.update(pos, tl.durationMs)
      let i = -1
      for (let lo = 0, hi = ev.length - 1; lo <= hi; ) {
        const mid = (lo + hi) >> 1
        if (ev[mid]!.startMs <= pos) {
          i = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      const key = `${Math.floor(a.beatAt(pos) + 1e-6)}|${i}`
      if (key !== last) {
        last = key
        const t0 = performance.now()
        setM(moment(tl, pos, { instrument, lens }))
        perf.work(performance.now() - t0)
      }
      if (manual.playing) raf = requestAnimationFrame(frame)
    }
    frame()
    const off = manual.onJump(() => {
      cancelAnimationFrame(raf)
      last = ''
      frame()
    })
    return () => {
      cancelAnimationFrame(raf)
      off()
    }
  }, [tl, instrument, lens])
  return m
}

/** The progress row registers its DOM nodes here; the frame loop writes to them directly. */
const progress = {
  fill: null as HTMLElement | null,
  time: null as HTMLElement | null,
  range: null as HTMLInputElement | null,
  dragging: false,
  update(pos: number, dur: number) {
    if (this.fill) this.fill.style.width = `${dur ? ((pos / dur) * 100).toFixed(2) : 0}%`
    if (this.time) this.time.textContent = fmt(pos)
    if (this.range && !this.dragging) this.range.value = String(Math.round(pos))
  },
}

const fmt = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const keyName = (k: MomentKey): string => (k.mode === 'minor' ? `${k.tonic} minor` : k.tonic)

function monogram(title: string): string {
  const words = title.replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words.map((w) => w[0]).join('') : title.slice(0, 4)).slice(0, 5).toUpperCase()
}

function StandView({ tl, meta, m, settings }: { tl: Timeline; meta: TrackMeta; m: Moment; settings: Settings }) {
  const setSettings = useSettings((s) => s.set)
  const inst = settings.instrument
  const home = homeKey(tl, inst)
  const bpm = tempoAt(tl, m.positionMs)
  const section = sectionLabel(tl, m.barIndex)
  const barPos = barPosition(tl, m.barIndex)
  const playing = manual.playing

  const kc = m.keyChange
  const kcBar = useMemo(() => {
    if (!kc) return null
    const ev = analyseTimeline(tl).events[kc.eventIndex]
    const bi = ev ? barIndexAt(tl, ev.startMs + 1) : -1
    const pos = barPosition(tl, bi)
    const sec = sectionLabel(tl, bi)
    return { n: pos?.n ?? null, section: sec && sec !== section ? sec : null }
  }, [kc, tl, section])

  const alt = m.scales
    ? settings.lens === 'colour'
      ? m.scales.inside
      : m.scales.colour
    : null
  const view = playView(m, settings.mode)
  const nextInst = INSTRUMENT_IDS[(INSTRUMENT_IDS.indexOf(inst) + 1) % INSTRUMENT_IDS.length]!

  return (
    <div className="stand">
      <header className="np">
        <button
          type="button"
          className="art playbtn"
          aria-label={playing ? 'Pause' : 'Play'}
          aria-pressed={playing}
          title={meta.title}
          onClick={() => manual.toggle()}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="3" y="2" width="3.5" height="12" rx="1" />
              <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 2.2v11.6c0 .6.6.9 1.1.6l9-5.8c.5-.3.5-.9 0-1.2l-9-5.8C4.6 1.3 4 1.6 4 2.2z" />
            </svg>
          )}
          <span className="mono-gram">{monogram(meta.title)}</span>
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="np-title">{meta.title}</div>
          <div className="np-sub">{meta.artist ? `${meta.artist} · ` : ''}Recorded · manual clock</div>
        </div>
        <SyncBadge state={{ kind: playing ? 'manual' : 'paused' }} />
      </header>

      <div className="prog">
        <span
          className="mono"
          ref={(el) => {
            progress.time = el
          }}
        >
          {fmt(m.positionMs)}
        </span>
        <div className="pbar">
          <i
            ref={(el) => {
              progress.fill = el
            }}
          />
          <input
            type="range"
            aria-label="Song position"
            min={0}
            max={Math.round(tl.durationMs)}
            step={100}
            defaultValue={Math.round(m.positionMs)}
            ref={(el) => {
              progress.range = el
            }}
            onPointerDown={() => (progress.dragging = true)}
            onPointerUp={() => (progress.dragging = false)}
            onPointerCancel={() => (progress.dragging = false)}
            onInput={(e) => manual.seek(Number(e.currentTarget.value))}
          />
        </div>
        <span className="mono">{fmt(tl.durationMs)}</span>
      </div>

      <div className="chips">
        {home && (
          <span className="chip">
            <em>Home</em>
            <b>
              <Acc text={keyText(home)} />
            </b>
          </span>
        )}
        {m.key && (
          <span className="chip now">
            <em>Now</em>
            <b>
              <Acc text={keyText(m.key)} />
            </b>
          </span>
        )}
        {bpm !== null && (
          <span className="chip">
            <b className="mono">{bpm}</b>
            <em>BPM</em>
          </span>
        )}
        <span className="chip">
          <b>
            {tl.meter.num}/{tl.meter.den}
          </b>
          {meta.style && <em>{meta.style.replace(/^(Medium|Up|Slow|Fast)\s+/i, '')}</em>}
        </span>
      </div>

      <section className="card hero" aria-label="Current chord">
        <div className="hero-top">
          <span className="lbl">{section ?? (m.chord ? 'Now' : 'Before the first chord')}</span>
          <SourceBadge source={tl.source} />
        </div>
        <div className="hero-mid">
          <div className="hero-chord" data-testid="hero-chord">
            <ChordSym chord={m.chord} />
          </div>
        </div>
        <div className="hero-bot">
          <span className="hero-fn">
            {m.fn && m.key ? (
              <>
                <b>
                  <Acc text={m.fn.text} />
                </b>{' '}
                in <Acc text={keyName(m.key)} />
              </>
            ) : null}
          </span>
          <div className="beats" aria-label={`Beat ${m.beatInBar + 1} of ${tl.meter.num}`}>
            {Array.from({ length: Math.min(tl.meter.num, 9) }, (_, i) => (
              <i key={i} className={(i === 0 ? 'one' : '') + (i === m.beatInBar && m.bar ? ' on' : '')} />
            ))}
          </div>
        </div>
      </section>

      <section className="card next" aria-label="Up next">
        <div className="next-h">
          <span className="lbl">Up next</span>
          {barPos && (
            <span className="lbl">
              Bar {barPos.n} / {barPos.total}
            </span>
          )}
        </div>
        <ol>
          {m.next.map((n) => (
            <li key={n.eventIndex}>
              <ChordSym chord={n.chord} />
              <span className="mono">{n.inBeats === 1 ? '1 beat' : `${n.inBeats} beats`}</span>
            </li>
          ))}
          {m.next.length === 0 && <li className="none">End</li>}
        </ol>
      </section>

      <section className={`card kc${kc && kc.inBeats <= 4 ? ' soon' : ''}`} aria-label="Key change">
        <span className="lbl">Key change</span>
        {kc ? (
          <>
            <span className="big">
              <span className="from">
                <Acc text={keyName(kc.from)} />
              </span>{' '}
              <span className="arrow">→</span> <Acc text={keyText(kc.to)} />
            </span>
            <span className="meta mono">{kc.inBeats} beats</span>
            <span className="meta at">
              {kcBar?.n ? `At bar ${kcBar.n}` : 'Ahead'}
              {kcBar?.section ? ` of ${kcBar.section}` : ''}, on <ChordSym chord={kc.chord} style={{ fontSize: 16 }} />
            </span>
            <span className="meter">
              <i style={{ width: `${Math.max(4, (1 - Math.min(kc.inBeats, 16) / 16) * 100)}%` }} />
            </span>
          </>
        ) : (
          <>
            <span className="big">None ahead</span>
            <span />
          </>
        )}
      </section>

      <section className="card scale" aria-label="Play">
        <div className="scale-top">
          <Seg
            mini
            name="pmode"
            label="Suggestions"
            value={settings.mode}
            options={[
              ['simple', 'Simple'],
              ['integrated', 'Integrated'],
              ['advanced', 'Advanced'],
            ]}
            onChange={(mode) => setSettings({ mode })}
          />
          <Seg
            mini
            name="nview"
            label="Show notes as"
            value={settings.notes}
            options={[
              ['staff', 'Staff'],
              ['keys', 'Keys'],
            ]}
            onChange={(notes) => setSettings({ notes })}
          />
        </div>
        {view ? (
          <>
            <div className="scale-h">
              <b>
                <Acc text={view.title} />
              </b>
              {settings.mode === 'advanced' && m.scale && alt && alt.id !== m.scale.id && (
                <span>
                  or <Acc text={`${alt.root} ${alt.name}`} />
                </span>
              )}
              <button
                type="button"
                className="lbl inst-btn"
                title={`Switch to ${INSTRUMENT_SHORT[nextInst]}`}
                onClick={() => setSettings({ instrument: nextInst })}
              >
                <Acc text={m.instrumentLabel} />
              </button>
            </div>
            {settings.notes === 'staff' ? (
              <div className="staffbox">
                <Staff chord={view.chord} notes={view.notes} s={7.5} g={view.chord ? 27 : 37} octave names />
              </div>
            ) : (
              <div className="kb">
                <Keyboard notes={view.notes} w={372} h={76} />
              </div>
            )}
            <Footer m={m} view={view} />
          </>
        ) : (
          <p className="scale-none">No chord sounding.</p>
        )}
      </section>
    </div>
  )
}

/** The line under the staff: a callout when Integrated has one, else the pentatonic, guide tones or chord tones. */
function Footer({ m, view }: { m: Moment; view: PlayView }) {
  const c = view.callout
  if (c)
    return (
      <div className={`gt callout ${c.kind}`} data-testid="callout">
        {c.kind === 'keychange' ? (
          <>
            <span className="lbl">Key change</span>
            <span>
              <Acc text={c.lead} />
            </span>
            {c.changed.length > 0 && <span>· new:</span>}
          </>
        ) : (
          <span>
            <Acc text={c.lead} />
          </span>
        )}
        {c.changed.map((n) => (
          <b key={n} className="x">
            <Acc text={n} />
          </b>
        ))}
        {c.kind === 'outside' && (
          <span>
            over <ChordSym chord={m.chord} style={{ fontSize: 17 }} />
          </span>
        )}
      </div>
    )
  if (view.footer === 'pentatonic')
    return (
      <div className="gt">
        <span className="lbl">
          <Acc text={view.sub} />
        </span>
        {view.notes
          .filter((n) => n.role === 't')
          .map((n) => (
            <b key={n.name} className="t">
              <Acc text={n.name} />
            </b>
          ))}
      </div>
    )
  if (view.footer === 'none') return null
  return <Guide m={m} />
}

/** How the 3rd and 7th move into the next chord; for triads (most pop), the chord tones instead. */
function Guide({ m }: { m: Moment }) {
  const next = m.next[0]
  if (m.guide && next)
    return (
      <div className="gt">
        <span className="lbl">
          Guide tones into <ChordSym chord={next.chord} style={{ fontSize: 17 }} />
        </span>
        {m.guide.map((g) => (
          <span key={g.fromSlot}>
            <b>
              <Acc text={g.from} />
            </b>
            <sub>{g.fromSlot}</sub> → <b>
              <Acc text={g.to} />
            </b>
            <sub>{g.toSlot}</sub>
          </span>
        ))}
      </div>
    )
  if (!m.tones.length) return null
  return (
    <div className="gt">
      <span className="lbl">Chord tones</span>
      {m.tones.map((t) => (
        <span key={t.slot}>
          <b className={t.slot === '3' || t.slot === '7' ? 'g' : ''}>
            <Acc text={t.name} />
          </b>
          <sub>{t.degree}</sub>
        </span>
      ))}
    </div>
  )
}
