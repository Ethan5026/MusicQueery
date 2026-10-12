// Solo view (M9): the lead melody on a big treble staff in written pitch, scrolling under a fixed playhead with two
// bars of look-ahead; the chords above at their places, rests in empty beats, names under the notes, faint notes
// where the transcription is unsure. Time runs left to right in proportion (a beat is a fixed width), so what you
// see lines up with what you hear without engraved rhythms. Below, the Play mode's scale at full width with the
// notes the melody uses in the look-ahead marked in brass. Portrait sits under the progress bar; sideways it fills
// the screen. Re-renders once per beat like the rest of Stand; the strip moves per frame by transform (D-44).
import type { Timeline } from '@mq/model'
import { type InstrumentId, type Moment, analyseTimeline, mod, momentChord, note, pc } from '@mq/theory'
import { memo, type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { activeTransport, useSession } from '../../services'
import { type Settings, useSettings } from '../../store/settings'
import type { TrackMeta } from '../../timeline/library'
import { Acc, ChordSym, Seg } from '../atoms'
import { InstrumentSeg } from './InstrumentSeg'
import { frameBus } from './live'
import { LoopButton } from './Loop'
import { playView } from './play'
import { type SoloLine, melodyPcs, soloLine, soloWindow } from './melody'
import { LiveSyncBadge, PlayIcon } from './Stand'
import { Staff } from './Staff'
import { keyText, sectionLabel, barPosition, homeKey } from './view'

/** Bars of look-ahead right of the playhead, and where the playhead sits across the roll. */
const LOOK_BARS = 2
const PLAYHEAD = 0.2

/** The analysed timeline that carries a melody (a linked chart or a listen only renames the chords). */
export function useMelody(): Timeline | null {
  const tl = useSession((s) => s.timeline)
  return tl?.melody?.length ? tl : null
}

export function StandSwitch({ name }: { name: string }) {
  const stand = useSettings((s) => s.stand)
  const set = useSettings((s) => s.set)
  return (
    <Seg
      mini
      name={name}
      label="Stand shows"
      value={stand}
      options={[
        ['chart', 'Chart'],
        ['solo', 'Solo'],
      ]}
      onChange={(v) => set({ stand: v })}
    />
  )
}

function useWidth<T extends HTMLElement>(initial: number): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => setW(Math.max(200, Math.floor(el.clientWidth)))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

const dbl = (s: string): string => s.replace(/♯♯/g, '𝄪').replace(/♭♭/g, '𝄫')
const ACC = ['𝄫', '♭', '', '♯', '𝄪']

interface RollProps {
  line: SoloLine
  /** beat grid (the melody's timeline) */
  base: Timeline
  /** chords shown (fixes, a linked chart) */
  shown: Timeline
  inst: InstrumentId
  from: number
  to: number
  ppb: number
  s: number
}

/** One window of the roll: bar lines, chords, notes with duration bars, rests, names. Drawn once per bar. */
const Roll = memo(function Roll({ line, base, shown, inst, from, to, ppb, s }: RollProps) {
  const half = s / 2
  const chordH = s * 2.6
  const botY = chordH + 8 * s
  const h = botY + 3.4 * s + s * 2
  const Y = (p: number): number => botY - (p - 30) * half
  const X = (beat: number): number => (beat - from) * ppb
  const rx = s * 0.62
  const ry = s * 0.45
  const fs = s * 2.2
  const a = analyseTimeline(base)
  const { notes, rests } = soloWindow(line.notes, from, to)
  const out: ReactNode[] = []
  let k = 0

  // bar lines from the melody's grid
  const barBeats = base.bars.map((b) => Math.round(a.beatAt(b.startMs)))
  for (const bb of barBeats) {
    if (bb < from || bb > to) continue
    out.push(<line key={k++} className="st-bar" x1={X(bb)} x2={X(bb)} y1={botY - 4 * s} y2={botY} />)
  }
  // accidentals per bar: a natural where the same line or space had one earlier in the bar
  const barOf = (beat: number): number => {
    let i = 0
    while (i + 1 < barBeats.length && barBeats[i + 1]! <= beat + 1e-6) i++
    return i
  }
  let curBar = -1
  let seen: Record<number, number> = {}
  let lastName = -Infinity
  for (const n of notes) {
    const x0 = X(n.startBeat)
    const x1 = Math.max(x0 + rx * 2, X(n.endBeat) - 2)
    const y = Y(n.p)
    const cx = x0 + rx
    const bi = barOf(n.startBeat)
    if (bi !== curBar) {
      curBar = bi
      seen = {}
    }
    const acc = n.acc !== 0 ? ACC[n.acc + 2]! : seen[n.p] ? '♮' : ''
    seen[n.p] = n.acc
    const cls = n.faint ? ' faint' : ''
    out.push(<rect key={k++} className={`sl-dur${cls}`} x={cx} y={y - ry * 0.5} width={Math.max(0, x1 - cx)} height={ry} rx={ry * 0.5} />)
    for (let q = 28; q >= n.p; q -= 2) out.push(<line key={k++} className="st-led" x1={cx - rx - 3} x2={cx + rx + 3} y1={Y(q)} y2={Y(q)} />)
    for (let q = 40; q <= n.p; q += 2) out.push(<line key={k++} className="st-led" x1={cx - rx - 3} x2={cx + rx + 3} y1={Y(q)} y2={Y(q)} />)
    if (acc)
      out.push(
        <text key={k++} className={`st-acc${cls}`} x={cx - rx - 1} y={y - (acc === '♭' ? s * 0.32 : 0)} fontSize={fs} textAnchor="end">
          {acc}
        </text>,
      )
    out.push(<ellipse key={k++} className={`nh sl${cls}`} cx={cx} cy={y} rx={rx} ry={ry} transform={`rotate(-20 ${cx} ${y})`} />)
    // a name only where it has room: fast runs keep the first of each crowded group
    if (cx - lastName >= s * 2) {
      lastName = cx
      out.push(
        <text key={k++} className={`st-nm sl${cls}`} x={cx} y={h - 4} fontSize={s * 1.25}>
          {dbl(n.name)}
        </text>,
      )
    }
  }
  for (const r of rests)
    out.push(
      <text key={k++} className="sl-rest" x={X(r)} y={botY - 2 * s} fontSize={s * 3.2}>
        𝄽
      </text>,
    )

  // chords at their places, written pitch
  const ev = analyseTimeline(shown).events
  const chords: ReactNode[] = []
  for (const e of ev) {
    const sb = a.beatAt(e.startMs)
    if (a.beatAt(e.endMs) <= from || sb >= to || e.chord.kind === 'nc') continue
    chords.push(
      <span key={e.index} className="sl-ch" style={{ left: Math.max(0, X(sb)) }}>
        <ChordSym chord={momentChord(e.chord, inst)} />
      </span>,
    )
  }
  const w = Math.ceil(X(to))
  return (
    <>
      <svg className="sl-svg" width={w} height={h} viewBox={`0 0 ${w} ${h.toFixed(1)}`} aria-hidden="true">
        {out}
      </svg>
      {chords}
    </>
  )
})

/** The scrolling melody staff. `s` = staff space in px. */
export function SoloStaff({ base, shown, m, inst, s }: { base: Timeline; shown: Timeline; m: Moment; inst: InstrumentId; s: number }) {
  const line = useMemo(() => soloLine(base, inst), [base, inst])
  const [box, w] = useWidth<HTMLDivElement>(360)
  const strip = useRef<HTMLDivElement>(null)
  const a = analyseTimeline(base)
  const num = base.meter.num
  const clefW = s * 3.4
  const rollW = w - clefW
  const ppb = (rollW * (1 - PLAYHEAD)) / (LOOK_BARS * num)
  // the window starts a bar before the current one and runs past the look-ahead; it moves once a bar
  const b0 = a.beatAt(m.positionMs)
  const bar0 = Math.floor(b0 / num) * num
  const from = bar0 - num
  const to = bar0 + (LOOK_BARS + 2) * num

  useEffect(() => {
    const f = (pos: number) => {
      const el = strip.current
      if (el) el.style.transform = `translateX(${(PLAYHEAD * rollW - (a.beatAt(pos) - from) * ppb).toFixed(1)}px)`
    }
    f(m.positionMs)
    frameBus.add(f)
    return () => void frameBus.delete(f)
  }, [a, from, ppb, rollW, m.positionMs])

  const half = s / 2
  const botY = s * 2.6 + 8 * s
  const h = botY + 3.4 * s + s * 2
  return (
    <div className="sl" ref={box} style={{ height: h }} data-testid="solo-staff">
      <svg className="sl-staff" width={w} height={h} aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} className="st-line" x1={0} x2={w} y1={botY - i * s} y2={botY - i * s} />
        ))}
        <text className="st-clef" x={1} y={botY - s} fontSize={s * 4.1}>
          𝄞
        </text>
      </svg>
      <div className="sl-roll" style={{ left: clefW, width: rollW }}>
        <div className="sl-strip" ref={strip}>
          <Roll line={line} base={base} shown={shown} inst={inst} from={from} to={to} ppb={ppb} s={s} />
        </div>
        <i className="sl-ph" style={{ left: PLAYHEAD * rollW, top: s * 2.6 + 4 * s - half, height: 5 * s }} />
      </div>
    </div>
  )
}

/** The Play mode's scale at full width, the notes the melody uses in the look-ahead in brass, and any it adds. */
export function SoloScale({ base, m, settings }: { base: Timeline; m: Moment; settings: Settings }) {
  const view = playView(m, settings.mode, { preview: false })
  const line = soloLine(base, settings.instrument)
  const a = analyseTimeline(base)
  const b = a.beatAt(m.positionMs)
  const ahead = LOOK_BARS * base.meter.num
  const used = melodyPcs(line.notes, b, b + ahead)
  if (!view) return <p className="scale-none">No chord sounding.</p>
  const inScale = new Set(view.notes.map((n) => pc(note(n.name))))
  const extra: string[] = []
  for (const n of soloWindow(line.notes, b, b + ahead).notes)
    if (!inScale.has(mod(n.midi, 12)) && !extra.includes(n.name)) extra.push(n.name)
  const notes = view.notes.map((n) => ({ name: n.name, role: used.has(pc(note(n.name))) ? ('t' as const) : ('' as const) }))
  return (
    <div className="sl-scale">
      <div className="scale-h">
        <b>
          <Acc text={view.title} />
        </b>
        <span>melody notes in brass{extra.length ? ' · also ' : ''}</span>
        {extra.map((n) => (
          <b key={n} className="sl-extra">
            <Acc text={n} />
          </b>
        ))}
      </div>
      <div className="staffbox sl-wide">
        <Staff chord={null} notes={notes} s={7.5} g={34} octave names />
      </div>
    </div>
  )
}

function NoMelody({ meta }: { meta: TrackMeta }) {
  const id = meta.id.startsWith('spotify:track:') ? meta.id.slice('spotify:track:'.length) : null
  return (
    <div className="empty sl-none" data-testid="no-melody">
      <p>
        No melody for this recording yet. The PC adds one when it analyses a song
        {id ? ' (on the PC: pnpm companion requeue-melody, then leave Spotify idle).' : '; built-in tunes and drills have none.'}
      </p>
    </div>
  )
}

/** Portrait: the chord now and next, the melody staff, then the scale. */
export function SoloCard({ shown, meta, m, settings }: { shown: Timeline; meta: TrackMeta; m: Moment; settings: Settings }) {
  const base = useMelody()
  const next = m.next[0]
  return (
    <>
      <section className="card sl-card" aria-label="Melody">
        <div className="sl-top">
          <ChordSym chord={m.chord} className="sl-now" />
          {next && (
            <span className="sl-next">
              <ChordSym chord={next.chord} /> <span className="mono">{next.inBeats === 1 ? '1 beat' : `${next.inBeats} beats`}</span>
            </span>
          )}
          <InstrumentSeg name="sinst" />
        </div>
        {base ? <SoloStaff base={base} shown={shown} m={m} inst={settings.instrument} s={11} /> : <NoMelody meta={meta} />}
      </section>
      {base && (
        <section className="card scale" aria-label="Scale">
          <SoloScale base={base} m={m} settings={settings} />
        </section>
      )}
    </>
  )
}

/** Sideways: a header like the lead sheet's, the big staff, the scale below. */
export function SoloSheet({ shown, meta, m, settings }: { shown: Timeline; meta: TrackMeta; m: Moment; settings: Settings }) {
  const base = useMelody()
  const inst = settings.instrument
  const t = activeTransport()
  const home = homeKey(shown, inst)
  const pos = m.barIndex >= 0 ? barPosition(shown, m.barIndex) : null
  const where = sectionLabel(shown, m.barIndex) ?? (pos ? `Bar ${pos.n} of ${pos.total}` : 'Count-in')
  const next = m.next[0]
  return (
    <div className="sapp" data-testid="solo-sheet">
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
          </span>
        </div>
        <div className="sl-top">
          <ChordSym chord={m.chord} className="sl-now" />
          {next && (
            <span className="sl-next">
              <ChordSym chord={next.chord} /> <span className="mono">{next.inBeats}</span>
            </span>
          )}
        </div>
        <StandSwitch name="lstand" />
        <InstrumentSeg name="linst2" />
        <LoopButton tl={shown} />
        <LiveSyncBadge />
      </header>
      {base ? (
        <>
          <SoloStaff base={base} shown={shown} m={m} inst={inst} s={12} />
          <SoloScale base={base} m={m} settings={settings} />
        </>
      ) : (
        <NoMelody meta={meta} />
      )}
    </div>
  )
}

