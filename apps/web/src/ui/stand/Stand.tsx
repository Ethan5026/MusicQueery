// Stand: the sketch's main screen. Portrait reads top to bottom in order of urgency; held sideways it becomes the
// lead sheet (LeadSheet.tsx). Everything comes from theory.moment() on the open timeline at the active clock's
// position (D-16): Spotify when it plays something, else the app's own clock. React re-renders once per beat or
// chord change; the progress bar and playhead move every frame through refs (D-44).
import type { Timeline } from '@mq/model'
import { type Moment, type MomentKey, analyseTimeline } from '@mq/theory'
import { useEffect, useMemo, useRef } from 'react'
import { useListen } from '../../listen/listener'
import { type Driver, activeTransport, clock, retryFollow, useApp, useSession } from '../../services'
import { login } from '../../spotify/auth'
import { type Settings, useSettings } from '../../store/settings'
import type { TrackMeta } from '../../timeline/library'
import { AnalyseButton } from '../AnalyseButton'
import { Acc, ChordSym, Seg, SourceBadge, SyncBadge } from '../atoms'
import { Calibrate } from './Calibrate'
import { FixChord } from './FixChord'
import { InstrumentSeg } from './InstrumentSeg'
import { Keyboard } from './Keyboard'
import { LeadSheet } from './LeadSheet'
import { LinkChart } from './LinkChart'
import { Confidence, ListenButton, ListenChip, ListeningWait } from './Listen'
import { LoopBand, LoopButton } from './Loop'
import { frameBus, useLandscape, useMoment, useShown, useStandUi, useSync } from './live'
import { type PlayView, playView } from './play'
import { Staff } from './Staff'
import { barIndexAt, barPosition, homeKey, keyText, sectionLabel, tempoAt } from './view'


export function Stand() {
  const { meta, status, driver } = useSession()
  const settings = useSettings()
  const shown = useShown()
  const m = useMoment(shown, settings)
  const land = useLandscape()
  const calibrating = useStandUi((s) => s.calibrating)
  const fixing = useStandUi((s) => s.fixing)
  const linking = useStandUi((s) => s.linking)
  let body
  if (shown && meta && m)
    body = land ? (
      <LeadSheet tl={shown} meta={meta} m={m} settings={settings} />
    ) : (
      <StandView tl={shown} meta={meta} m={m} settings={settings} />
    )
  else if (driver === 'spotify' && meta) body = <NotAnalysed meta={meta} status={status} />
  else if (status === 'loading') body = <div className="stand-empty">Opening…</div>
  else body = <NothingPlaying />
  return (
    <>
      {body}
      {calibrating && <Calibrate />}
      {fixing && shown && m && <FixChord tl={shown} m={m} />}
      {linking && meta && <LinkChart title={meta.title} />}
    </>
  )
}

export const fmt = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const keyName = (k: MomentKey): string => (k.mode === 'minor' ? `${k.tonic} minor` : k.tonic)

function monogram(title: string): string {
  const words = title.replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words.map((w) => w[0]).join('') : title.slice(0, 4)).slice(0, 5).toUpperCase()
}

export function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="2" width="3.5" height="12" rx="1" />
      <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.2v11.6c0 .6.6.9 1.1.6l9-5.8c.5-.3.5-.9 0-1.2l-9-5.8C4.6 1.3 4 1.6 4 2.2z" />
    </svg>
  )
}

/** The sync badge, wired: tap to calibrate this speaker (Spotify) or to log in (not connected). */
export function LiveSyncBadge() {
  const st = useSync()
  const driver = useSession((s) => s.driver)
  const setCalibrating = useStandUi((s) => s.setCalibrating)
  if (st.kind === 'offline')
    return <SyncBadge state={st} title="Log in to Spotify" onClick={() => void login().catch(() => {})} />
  if (driver === 'spotify' && st.kind !== 'idle')
    return <SyncBadge state={st} title="Calibrate this speaker" onClick={() => setCalibrating(true)} />
  return <SyncBadge state={st} />
}

/** "Artist · on Living Room TV" following Spotify, "Swing · 140 BPM · Backing band" for the band, else "Recorded". */
function subtitle(meta: TrackMeta, driver: Driver): string {
  const where =
    driver === 'spotify'
      ? clock.last?.deviceName
        ? `on ${clock.last.deviceName}`
        : 'Spotify'
      : driver === 'audio'
        ? 'Backing band'
        : 'Recorded · manual clock'
  return meta.artist ? `${meta.artist} · ${where}` : where
}

/** Header: the art tile is play/pause on the active transport (the app's clock, or Spotify on any device). */
function NowPlaying({ meta }: { meta: TrackMeta }) {
  const driver = useSession((s) => s.driver)
  useSync() // re-render on play/pause and device changes
  const t = activeTransport()
  const playing = t.clock.playing
  return (
    <header className="np">
      <button
        type="button"
        className="art playbtn"
        aria-label={playing ? 'Pause' : 'Play'}
        aria-pressed={playing}
        title={meta.title}
        onClick={() => t.toggle()}
      >
        <PlayIcon playing={playing} />
        <span className="mono-gram">{monogram(meta.title)}</span>
      </button>
      <div style={{ minWidth: 0 }}>
        <div className="np-title">{meta.title}</div>
        <div className="np-sub">{subtitle(meta, driver)}</div>
      </div>
      <LiveSyncBadge />
    </header>
  )
}

function Progress({ tl, durationMs, positionMs }: { tl: Timeline; durationMs: number; positionMs: number }) {
  const fill = useRef<HTMLElement>(null)
  const time = useRef<HTMLSpanElement>(null)
  const range = useRef<HTMLInputElement>(null)
  const dragging = useRef(false)
  const driver = useSession((s) => s.driver)
  useEffect(() => {
    const f = (pos: number, dur: number) => {
      if (fill.current) fill.current.style.width = `${dur ? Math.min(100, (pos / dur) * 100).toFixed(2) : 0}%`
      if (time.current) time.current.textContent = fmt(pos)
      if (range.current && !dragging.current) range.current.value = String(Math.round(pos))
    }
    frameBus.add(f)
    // Spotify and the band get one seek when the thumb is let go (the native change event, not React's onChange).
    const el = range.current
    const release = () => {
      if (el && useSession.getState().driver !== 'manual') activeTransport().seek(Number(el.value))
    }
    el?.addEventListener('change', release)
    return () => {
      frameBus.delete(f)
      el?.removeEventListener('change', release)
    }
  }, [])
  return (
    <div className="prog">
      <span className="mono" ref={time}>
        {fmt(positionMs)}
      </span>
      <div className="pbar">
        <LoopBand durationMs={durationMs} />
        <i ref={fill} />
        <input
          type="range"
          aria-label="Song position"
          min={0}
          max={Math.round(durationMs)}
          step={100}
          defaultValue={Math.round(positionMs)}
          ref={range}
          onPointerDown={() => (dragging.current = true)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          // The manual clock follows the thumb.
          onInput={(e) => {
            if (driver === 'manual') activeTransport().seek(Number(e.currentTarget.value))
          }}
        />
      </div>
      <span className="mono">{fmt(durationMs)}</span>
      <LoopButton tl={tl} />
    </div>
  )
}

/** Following a Spotify track that has no analysed timeline yet. */
function NotAnalysed({ meta, status }: { meta: TrackMeta; status: string }) {
  const error = useSession((s) => s.error)
  const listening = useListen((s) => s.status === 'on')
  const sid = meta.id.replace('spotify:track:', '')
  if (listening && status !== 'loading')
    return (
      <div className="stand">
        <NowPlaying meta={meta} />
        <ListeningWait />
      </div>
    )
  return (
    <div className="stand">
      <NowPlaying meta={meta} />
      <div className="empty wait" data-testid="not-analysed">
        {status === 'loading' ? (
          <p>Looking for this recording’s chords…</p>
        ) : (
          <>
            <span className="ch">
              <span className="r">?</span>
            </span>
            <p>
              {status === 'error'
                ? `Couldn’t fetch the chords (${error}).`
                : 'No chords for this recording yet. Listen with the phone’s mic now, or have the PC analyse it.'}
            </p>
            <ListenButton />
            {status === 'missing' && (
              <AnalyseButton id={meta.id} title={meta.title} {...(meta.artist ? { artist: meta.artist } : {})} onDone={retryFollow} />
            )}
            <button type="button" className="btn" onClick={retryFollow}>
              Check again
            </button>
            <code className="tnote">or on the PC: pnpm companion analyse {sid}</code>
          </>
        )}
      </div>
    </div>
  )
}

/** The sketch's "Nothing playing" state. */
function NothingPlaying() {
  const authed = useApp((s) => s.authed)
  const setTab = useSession((s) => s.setTab)
  return (
    <div className="stand stand-wait">
      <div className="empty" data-testid="nothing-playing">
        <span className="ch">
          <span className="r">N.C.</span>
        </span>
        <p>Play something on Spotify, on this phone or any speaker, and the chart picks it up within a second.</p>
        {!authed && (
          <button type="button" className="btn primary" onClick={() => void login().catch(() => {})}>
            Log in with Spotify
          </button>
        )}
        <button type="button" className="btn" onClick={() => setTab('tracks')}>
          Open a recorded track
        </button>
      </div>
    </div>
  )
}

function StandView({ tl, meta, m, settings }: { tl: Timeline; meta: TrackMeta; m: Moment; settings: Settings }) {
  const setSettings = useSettings((s) => s.set)
  const setFixing = useStandUi((s) => s.setFixing)
  const listening = useListen((s) => s.status === 'on')
  const liveConf = useListen((s) => s.now?.confidence ?? null)
  const isLive = tl.source === 'live'
  const linkedTitle = useSession((s) => (s.linked && !s.live ? s.linked.link.title : null))
  const inst = settings.instrument
  const home = homeKey(tl, inst)
  const bpm = tempoAt(tl, m.positionMs)
  const section = sectionLabel(tl, m.barIndex)
  const barPos = barPosition(tl, m.barIndex)

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

  return (
    <div className="stand">
      <NowPlaying meta={meta} />
      <Progress tl={tl} durationMs={tl.durationMs} positionMs={m.positionMs} />

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
          <span className="hero-src">
            {isLive && listening && liveConf !== null && <Confidence value={liveConf} />}
            <ListenChip />
            <SourceBadge source={tl.source} listening={listening} />
          </span>
        </div>
        <div className="hero-mid">
          <button
            type="button"
            className="hero-chord"
            data-testid="hero-chord"
            aria-label="Fix this chord"
            disabled={m.eventIndex < 0 || tl.source === 'exact'}
            onClick={() => setFixing(true)}
          >
            <ChordSym chord={m.chord} />
          </button>
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

      <section className={`card next${isLive ? ' pred' : ''}`} aria-label="Up next">
        <div className="next-h">
          <span className="lbl">{isLive ? 'Up next · Predicted' : linkedTitle ? `Up next · ${linkedTitle} chart` : 'Up next'}</span>
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
          {m.next.length === 0 && <li className="none">{isLive ? 'After a repeat' : 'End'}</li>}
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
              <InstrumentSeg name="pinst" />
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
