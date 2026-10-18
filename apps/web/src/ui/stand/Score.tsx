// Lead sheet view (M10, replaces M9's Solo): the song engraved on staves from engrave.ts, at most two systems
// in view (one grand staff for piano), the one playing kept at the top so the next line shows what is coming.
// Saxes read one treble staff in written pitch: the scale for the chords. Piano (Concert) reads a grand staff:
// the scale in the right hand, the chord in the left in note values as long as it sounds. Key signatures,
// time signatures and changes are engraved where they fall; changes ahead are flagged in rust. A brass playhead
// sweeps the current system every frame (D-44); systems re-render only when the chord under them changes.
import type { Timeline } from '@mq/model'
import { type Moment, analyseTimeline } from '@mq/theory'
import { memo, type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { activeTransport } from '../../services'
import { type Settings, useSettings } from '../../store/settings'
import type { TrackMeta } from '../../timeline/library'
import { Acc, ChordSym, Seg } from '../atoms'
import {
  type ScoreNote,
  type System,
  FLAT_ORDER,
  FLAT_POS,
  SHARP_ORDER,
  SHARP_POS,
  U,
  beatX,
  engrave,
  isFull,
  layout,
  msAtBeat,
  noteValues,
  sigAccs,
  xBeat,
} from './engrave'
import { Accidental } from './accidentals'
import { InstrumentSeg } from './InstrumentSeg'
import { frameBus } from './live'
import { LoopButton } from './Loop'
import { LiveSyncBadge, PlayIcon } from './Stand'
import { homeKey, keyText, sectionLabel, barPosition, tempoAt } from './view'

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
        ['score', 'Lead sheet'],
      ]}
      onChange={(v) => set({ stand: v })}
    />
  )
}

function ModeSeg({ name }: { name: string }) {
  const mode = useSettings((s) => s.mode)
  const set = useSettings((s) => s.set)
  return (
    <Seg
      mini
      name={name}
      label="Scales"
      value={mode}
      options={[
        ['simple', 'Simple'],
        ['integrated', 'Integrated'],
        ['advanced', 'Advanced'],
      ]}
      onChange={(v) => set({ mode: v })}
    />
  )
}

// ---------------------------------------------------------------- geometry (staff spaces)

/** Vertical layout of one system: a label row, the chord row, room for ledgers, the staff (or two). */
function geom(piano: boolean) {
  const lbl = 1.5
  const chord = 2.9
  const tTop = lbl + chord + 2.3
  const tBot = tTop + 4
  const bTop = tBot + 3.6
  const bBot = bTop + 4
  const h = piano ? bBot + 2.3 : tBot + 1.8
  return { lbl, chord, tTop, tBot, bTop, bBot, h }
}

const REST: Record<number, string> = { 1: '𝄻', 0.5: '𝄼', 0.25: '𝄽', 0.125: '𝄾', 0.0625: '𝄿' }

interface SysProps {
  tl: Timeline
  sys: System
  piano: boolean
  s: number
  /** event index of the chord playing, when it is in this system; −1 otherwise */
  active: number
  onSeek: (ms: number) => void
}

/** One system: staves, clef, signatures, bars with chords, scale runs, bass chords, rests, repeats. */
const SystemView = memo(function SystemView({ tl, sys, piano, s, active, onSeek }: SysProps) {
  const g = geom(piano)
  const W = sys.width * s
  const H = g.h * s
  const out: ReactNode[] = []
  const html: ReactNode[] = []
  let k = 0
  const yT = (p: number): number => (g.tBot - (p - 30) / 2) * s
  const yB = (p: number): number => (g.bBot - (p - 18) / 2) * s
  const top = g.tTop * s
  const bot = (piano ? g.bBot : g.tBot) * s
  const rx = s * 0.62
  const ry = s * 0.45

  const staffLines = (y0: number) =>
    [0, 1, 2, 3, 4].map((i) => <line key={k++} className="st-line" x1={0} x2={W} y1={y0 + i * s} y2={y0 + i * s} />)
  out.push(...staffLines(top))
  if (piano) out.push(...staffLines(g.bTop * s))
  // the system's left line and, for piano, a brace
  out.push(<line key={k++} className="st-bar" x1={0.5} x2={0.5} y1={top} y2={bot} />)
  if (piano) {
    const yb = bot
    const ym = (top + yb) / 2
    const bx = -s * 0.4
    out.push(
      <path
        key={k++}
        className="sc-brace"
        d={`M${bx} ${top} C${bx - s * 1.3} ${top + s * 1.5}, ${bx + s * 0.2} ${ym - s * 1.6}, ${bx - s * 1.0} ${ym} C${bx + s * 0.2} ${ym + s * 1.6}, ${bx - s * 1.3} ${yb - s * 1.5}, ${bx} ${yb}`}
      />,
    )
  }
  out.push(
    <text key={k++} className="st-clef" x={s * 0.3} y={(g.tBot - 1) * s} fontSize={s * 4.1}>
      𝄞
    </text>,
  )
  if (piano)
    out.push(
      <text key={k++} className="st-clef" x={s * 0.35} y={(g.bTop + 1) * s} fontSize={s * 3.3}>
        𝄢
      </text>,
    )

  const ledgers = (x: number, p: number, bass: boolean, r: number) => {
    const lo = bass ? 16 : 28
    const hi = bass ? 28 : 40
    const y = bass ? yB : yT
    const ls: ReactNode[] = []
    for (let q = lo; q >= p; q -= 2) ls.push(<line key={k++} className="st-led" x1={x - r - s * 0.35} x2={x + r + s * 0.35} y1={y(q)} y2={y(q)} />)
    for (let q = hi; q <= p; q += 2) ls.push(<line key={k++} className="st-led" x1={x - r - s * 0.35} x2={x + r + s * 0.35} y1={y(q)} y2={y(q)} />)
    return ls
  }
  const accGlyph = (x: number, y: number, a: string, cls = '', sig = false) =>
    a ? <Accidental key={k++} glyph={a} x={x} y={y} s={s} flag={cls.includes('flag')} sig={sig} /> : null

  /** Key signature (and naturals cancelling the old one) from x; returns the x after it. */
  const keySig = (x0: number, fifths: number, prev: number | null, cls: string): number => {
    let x = x0
    const both = (pos: number, glyph: string) => {
      out.push(accGlyph(x + s * 0.9, yT(pos), glyph, cls, true))
      if (piano) out.push(accGlyph(x + s * 0.9, yB(pos - 14), glyph, cls, true))
      x += U.sigAcc * s
    }
    if (prev !== null) {
      const before = sigAccs(prev)
      const after = sigAccs(fifths)
      const order = prev >= 0 ? SHARP_ORDER : FLAT_ORDER
      const pos = prev >= 0 ? SHARP_POS : FLAT_POS
      for (let i = 0; i < Math.abs(prev); i++) {
        const letter = order[i]!
        if (before[letter] !== 0 && after[letter] === 0) both(pos[i]!, '♮')
      }
    }
    for (let i = 0; i < Math.abs(fifths); i++) both((fifths > 0 ? SHARP_POS : FLAT_POS)[i]!, fifths > 0 ? '♯' : '♭')
    return x + (fifths ? U.sigPad * s : 0.4 * s)
  }
  const timeSig = (x: number, num: number, den: number, cls: string) => {
    for (const y0 of piano ? [top, g.bTop * s] : [top]) {
      out.push(
        <text key={k++} className={`sc-time${cls}`} x={x + U.time * s * 0.45} y={y0 + s} fontSize={s * 2.25}>
          {num}
        </text>,
        <text key={k++} className={`sc-time${cls}`} x={x + U.time * s * 0.45} y={y0 + 3 * s} fontSize={s * 2.25}>
          {den}
        </text>,
      )
    }
  }

  const first = sys.placed[0]!.m
  const headX = keySig(U.clef * s, first.sig.fifths, null, '')
  if (first.bar === 0) timeSig(headX, first.meter.num, first.meter.den, '')

  const vbar = (x: number, cls = 'st-bar') => <line key={k++} className={cls} x1={x} x2={x} y1={top} y2={bot} />

  for (const pl of sys.placed) {
    const m = pl.m
    const x0 = pl.x0 * s
    const x1 = pl.x1 * s
    let hx = x0
    if (pl.showSig) {
      out.push(vbar(x0 - s * 0.35))
      hx = keySig(x0, m.sig.fifths, m.prevSig?.fifths ?? null, ' flag')
    }
    if (pl.showMeter) timeSig(hx, m.meter.num, m.meter.den, ' flag')
    // bar line after, double at the end of a pass, final at the end of the song
    if (m.end) {
      out.push(vbar(x1 - s * 0.55))
      out.push(vbar(x1, 'st-end'))
    } else out.push(vbar(x1))

    // labels above: rehearsal letter, key (song start and every change)
    let lx = x0 + s * 0.2
    if (m.reh) {
      html.push(
        <span key={k++} className="sc-reh" style={{ left: lx, top: 0, fontSize: s * 1.2 }}>
          {m.reh}
        </span>,
      )
      lx += s * 2.2
    }
    if (m.keyChange || m.bar === 0)
      html.push(
        <span key={k++} className={`sc-key${m.keyChange ? ' flag' : ''}`} style={{ left: lx, top: 0, fontSize: s * 1.15 }}>
          <Acc text={m.keyChange ? `→ ${m.sig.name}` : m.sig.name} />
        </span>,
      )
    if (pl === sys.placed[0])
      html.push(
        <span key={k++} className="sc-num" style={{ left: s * 0.1, top: (g.tTop - 1.6) * s, fontSize: s * 0.95 }}>
          {m.n}
        </span>,
      )

    // chords at their beats; a chord carried in from the line before in brackets
    for (const c of m.chords) {
      if (c.held && !(pl.restate && c.beat === 0)) continue
      if (pl.repeat) continue // a repeated bar is the bar before, chords and all
      html.push(
        <span
          key={k++}
          className={`sc-ch${c.event === active ? ' on' : ''}${c.held ? ' held' : ''}`}
          style={{ left: beatX(pl, c.beat) * s - s * 0.2, top: g.lbl * s, fontSize: s * 2.1 }}
        >
          {c.held ? '(' : ''}
          <ChordSym chord={c.chord} />
          {c.held ? ')' : ''}
        </span>,
      )
    }

    if (pl.repeat) {
      const cx = (x0 + x1) / 2
      out.push(
        <text key={k++} className="sc-rep" x={cx} y={top + 2 * s} fontSize={s * 3}>
          𝄎
        </text>,
      )
      if (piano)
        out.push(
          <text key={k++} className="sc-rep" x={cx} y={(g.bTop + 2) * s} fontSize={s * 3}>
            𝄎
          </text>,
        )
      continue
    }

    // the treble: a run writes its scale across its beats, or stacks each chord that starts in it
    for (const r of m.runs) {
      if (isFull(m, r, pl.restate)) {
        const xa = beatX(pl, r.from) * s + U.acc * s * 0.5
        const xb = beatX(pl, r.to) * s
        const n = r.notes.length
        r.notes.forEach((nt: ScoreNote, j) => {
          const x = xa + ((j + 0.5) / n) * (xb - xa)
          const y = yT(nt.p)
          out.push(...ledgers(x, nt.p, false, rx))
          out.push(accGlyph(x - rx - s * 0.15, y, nt.glyph))
          out.push(<ellipse key={k++} className={`nh ${nt.role}`} cx={x} cy={y} rx={rx} ry={ry} transform={`rotate(-20 ${x} ${y})`} />)
        })
        continue
      }
      // a chord carried on with nothing new to write: rhythm slashes, one a beat, as a lead sheet keeps time
      if (!r.blocks.length)
        for (let b = Math.ceil(r.from); b < r.to; b++) {
          const x = (beatX(pl, b) + beatX(pl, Math.min(r.to, b + 1))) / 2 * s
          out.push(<line key={k++} className="sc-slash" x1={x - s * 0.55} x2={x + s * 0.55} y1={top + 2.6 * s} y2={top + 1.4 * s} />)
        }
      for (const b of r.blocks) {
        const accs = Math.min(2, b.notes.filter((n) => n.glyph).length)
        const x = beatX(pl, b.beat) * s + accs * U.acc * s + rx + s * 0.2
        let col = 0
        // accidentals right to left from the top, alternating columns so they don't collide
        for (const nt of [...b.notes].reverse()) {
          if (!nt.glyph) continue
          out.push(accGlyph(x - rx - s * 0.15 - col * U.acc * s, yT(nt.p), nt.glyph))
          col = 1 - col
        }
        let prevP = -99
        let shifted = false
        for (const nt of b.notes) {
          const shift: boolean = nt.p - prevP === 1 && !shifted
          shifted = shift
          prevP = nt.p
          const hx = x + (shift ? rx * 1.9 : 0)
          const y = yT(nt.p)
          out.push(...ledgers(hx, nt.p, false, rx))
          out.push(<ellipse key={k++} className={`nh ${nt.role}`} cx={hx} cy={y} rx={rx} ry={ry} transform={`rotate(-20 ${hx} ${y})`} />)
        }
      }
    }

    // rests: a whole-bar rest is the whole rest in the middle; else rest values from where the gap starts
    for (const rs of m.rests) {
      const whole = rs.from === 0 && rs.beats === m.beats
      const vals = whole ? [{ at: 0, base: 1, dots: 0 }] : noteValues(rs.beats, m.meter.den, false)
      for (const v of vals) {
        const x = whole ? (beatX(pl, 0) + beatX(pl, m.beats)) / 2 * s : beatX(pl, rs.from + v.at) * s + s
        for (const y0 of piano ? [top, g.bTop * s] : [top]) {
          out.push(
            <text key={k++} className="sc-rest" x={x} y={y0 + (v.base >= 0.5 ? (v.base === 1 ? 1.5 : 2) : 2) * s} fontSize={s * 3}>
              {REST[v.base] ?? '𝄽'}
            </text>,
          )
        }
      }
    }

    // bass chords (piano): the stack in note values, tied where a chord goes on
    for (const bp of m.bass) {
      const vals = noteValues(bp.beats, m.meter.den)
      const hasAcc = bp.stack.some((n) => n.glyph)
      const mid = bp.stack.reduce((t, n) => t + n.p, 0) / bp.stack.length
      const up = mid < 22
      vals.forEach((v, vi) => {
        const x = beatX(pl, bp.from + v.at) * s + (hasAcc && vi === 0 ? U.bassAcc * s : 0) + rx
        const open = v.base >= 0.5
        const stemless = v.base >= 1
        let prevP = -99
        let shifted = false
        const xs: number[] = []
        for (const nt of bp.stack) {
          // a second above the note before goes on the other side of the stem
          const shift: boolean = nt.p - prevP === 1 && !shifted
          shifted = shift
          prevP = nt.p
          const hx = x + (shift ? (up ? 1 : -1) * rx * 1.9 : 0)
          xs.push(hx)
          const y = yB(nt.p)
          out.push(...ledgers(hx, nt.p, true, rx))
          if (stemless) {
            out.push(<ellipse key={k++} className="wh" cx={hx} cy={y} rx={rx * 1.15} ry={ry * 1.05} />)
            out.push(<ellipse key={k++} className="wh-in" cx={hx} cy={y} rx={rx * 0.5} ry={ry * 0.7} transform={`rotate(55 ${hx} ${y})`} />)
          } else if (open) {
            out.push(<ellipse key={k++} className="sc-open" cx={hx} cy={y} rx={rx * 0.9} ry={ry * 0.82} transform={`rotate(-20 ${hx} ${y})`} />)
          } else out.push(<ellipse key={k++} className="nh" cx={hx} cy={y} rx={rx} ry={ry} transform={`rotate(-20 ${hx} ${y})`} />)
          if (v.dots) out.push(<circle key={k++} className="nh" cx={hx + rx * 1.9} cy={y - ((nt.p % 2 === 0) ? s * 0.5 : 0)} r={s * 0.17} />)
        }
        if (vi === 0) {
          // accidentals from the top down, alternating columns so a stack of them doesn't collide
          let col = 0
          for (const nt of [...bp.stack].reverse()) {
            if (!nt.glyph) continue
            out.push(accGlyph(x - rx * 1.15 - s * 0.15 - col * U.acc * s, yB(nt.p), nt.glyph))
            col = 1 - col
          }
        }
        const lo = bp.stack[0]!.p
        const hi = bp.stack[bp.stack.length - 1]!.p
        if (!stemless) {
          const sx = up ? x + rx * 0.95 : x - rx * 0.95
          const y1 = up ? yB(lo) : yB(hi)
          const y2 = up ? yB(hi) - 3.3 * s : yB(lo) + 3.3 * s
          out.push(<line key={k++} className="sc-stem" x1={sx} x2={sx} y1={y1} y2={y2} />)
          if (v.base <= 0.125)
            out.push(
              <path key={k++} className="sc-flag" d={up ? `M${sx} ${y2} c${s * 0.2} ${s * 1.2} ${s * 1.5} ${s * 1.4} ${s * 1.0} ${s * 3}` : `M${sx} ${y2} c${s * 0.2} ${-s * 1.2} ${s * 1.5} ${-s * 1.4} ${s * 1.0} ${-s * 3}`} />,
            )
        }
        // a tie to the next value, or over the bar line when the chord goes on
        const tieTo = vi + 1 < vals.length ? beatX(pl, bp.from + vals[vi + 1]!.at) * s + rx * 0.2 : bp.tieOut ? x1 + s * 0.6 : null
        if (tieTo !== null)
          for (const nt of bp.stack) {
            const y = yB(nt.p) + (up ? 1 : -1) * ry * 1.4
            const xa = x + rx * 1.1
            const dir = up ? 1 : -1
            out.push(<path key={k++} className="sc-tie" d={`M${xa} ${y} Q${(xa + tieTo) / 2} ${y + dir * s * 0.9} ${tieTo - rx} ${y}`} />)
          }
      })
    }
  }

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / s
    const pl = sys.placed.find((p) => x < p.x1) ?? sys.placed[sys.placed.length - 1]!
    const beat = pl.m.startBeat + xBeat(pl, x)
    onSeek(Math.max(pl.m.startMs, msAtBeat(tl, beat)) + 1)
  }
  return (
    <div className="sc-sys" style={{ height: H }} onClick={onClick}>
      <svg width={Math.ceil(W + 2)} height={Math.ceil(H)} aria-hidden="true" style={{ overflow: 'visible' }}>
        {out}
      </svg>
      {html}
    </div>
  )
})

function useBox<T extends HTMLElement>(): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null)
  const [box, setBox] = useState({ w: 360, h: 400 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => setBox({ w: Math.max(200, Math.floor(el.clientWidth)), h: Math.max(120, Math.floor(el.clientHeight)) })
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, box]
}

/** The engraved window: two systems for sax, one grand staff for piano, the current one at the top. */
export function ScoreView({ tl, m, settings }: { tl: Timeline; m: Moment; settings: Settings }) {
  const inst = settings.instrument
  const piano = inst === 'concert'
  const visible = piano ? 1 : 2
  const score = useMemo(() => engrave(tl, inst, settings.mode, settings.lens), [tl, inst, settings.mode, settings.lens])
  const [box, size] = useBox<HTMLDivElement>()
  const g = geom(piano)
  // staff size from the height, capped so a line still holds a bar or two; spare height goes between systems
  const s = Math.max(6.5, Math.min(11.5, size.h / (visible * g.h)))
  const marginL = piano ? s * 1.6 : s * 0.3
  const { systems, systemOf } = useMemo(() => layout(score, (size.w - marginL - 4) / s), [score, size.w, s, marginL])
  const sysH = Math.max(g.h * s, Math.min(g.h * s * 1.5, Math.floor(size.h / visible)))
  const sysPad = (sysH - g.h * s) / 2

  const curMeasure = m.barIndex >= 0 ? (score.measureOf[m.barIndex] ?? 0) : 0
  const curSys = systemOf[score.measures[curMeasure]?.bar ?? 0] ?? 0
  const topSys = Math.max(0, Math.min(curSys, systems.length - 1))

  // the playhead: per frame, inside the current system
  const ph = useRef<HTMLElement>(null)
  useEffect(() => {
    const a = analyseTimeline(tl)
    const sys = systems[curSys]
    const f = (pos: number) => {
      const el = ph.current
      if (!el || !sys) return
      const beat = a.beatAt(pos)
      let pl = sys.placed[0]!
      for (const p of sys.placed) if (p.m.startBeat <= beat + 1e-6) pl = p
      const rel = Math.max(0, Math.min(pl.m.beats, beat - pl.m.startBeat))
      const x = (pl.repeat ? pl.xin + (rel / pl.m.beats) * (pl.x1 - U.padR - pl.xin) : beatX(pl, rel)) * s + marginL
      el.style.transform = `translateX(${x.toFixed(1)}px)`
    }
    f(m.positionMs)
    frameBus.add(f)
    return () => void frameBus.delete(f)
  }, [tl, systems, curSys, s, marginL, m.positionMs])

  const seek = (ms: number) => activeTransport().seek(ms)
  const from = Math.max(0, topSys - 1)
  const to = Math.min(systems.length, topSys + visible + 1)
  return (
    <div className="sc-box" ref={box}>
    <div className="sc-win" style={{ height: visible * sysH }} data-testid="score" data-systems={systems.length} data-s={s.toFixed(2)} data-visible={visible}>
      {/* a new layout (instrument, mode, width) starts without the scrolling transition */}
      <div key={`${inst}|${settings.mode}|${settings.lens}|${size.w}|${s}`} className="sc-col" style={{ transform: `translateY(${(-topSys * sysH).toFixed(1)}px)`, height: systems.length * sysH }}>
        {systems.slice(from, to).map((sys) => (
          <div key={sys.index} className={`sc-row${sys.index === curSys ? ' cur' : ''}`} style={{ top: sys.index * sysH + sysPad, left: marginL }}>
            <SystemView tl={tl} sys={sys} piano={piano} s={s} active={sys.index === curSys ? m.eventIndex : -1} onSeek={seek} />
          </div>
        ))}
        <i className="sc-ph" ref={ph} style={{ top: curSys * sysH + sysPad + g.tTop * s - s, height: ((piano ? g.bBot : g.tBot) - g.tTop + 2) * s }} />
      </div>
    </div>
    </div>
  )
}

/** "→ E♭ major in 6 beats": the next key change, flagged once it is within four bars. */
function KeyFlag({ m }: { m: Moment }) {
  const kc = m.keyChange
  if (!kc || kc.inBeats > 16) return null
  return (
    <span className={`sc-flagline${kc.inBeats <= 4 ? ' soon' : ''}`} data-testid="key-flag">
      <Acc text={`→ ${keyText(kc.to)}`} /> in <b className="mono">{kc.inBeats}</b>
    </span>
  )
}

function NowNext({ m }: { m: Moment }) {
  const next = m.next[0]
  return (
    <span className="sc-nn">
      <ChordSym chord={m.chord} className="sc-now" />
      {next && (
        <span className="sc-next">
          <ChordSym chord={next.chord} /> <span className="mono">{next.inBeats}</span>
        </span>
      )}
      <KeyFlag m={m} />
    </span>
  )
}

const INST_NAME = { concert: 'Piano · concert pitch', alto: 'E♭ alto · written pitch', tenor: 'B♭ tenor · written pitch' } as const

/** Portrait: the chord now and next with any key change ahead, the controls, then the staves filling the screen. */
export function ScoreCard({ tl, m, settings }: { tl: Timeline; m: Moment; settings: Settings }) {
  return (
    <section className="card sc-card" aria-label="Lead sheet">
      <div className="sc-top">
        <NowNext m={m} />
      </div>
      <div className="sc-ctl">
        <ModeSeg name="smode" />
        <InstrumentSeg name="sinst" />
      </div>
      <span className="sc-cap">{INST_NAME[settings.instrument]}</span>
      <ScoreView tl={tl} m={m} settings={settings} />
    </section>
  )
}

/** Sideways: a header like the chart's, then the staves across the screen. */
export function ScoreSheet({ tl, meta, m, settings }: { tl: Timeline; meta: TrackMeta; m: Moment; settings: Settings }) {
  const inst = settings.instrument
  const t = activeTransport()
  const home = homeKey(tl, inst)
  const bpm = tempoAt(tl, m.positionMs)
  const pos = m.barIndex >= 0 ? barPosition(tl, m.barIndex) : null
  const where = sectionLabel(tl, m.barIndex) ?? (pos ? `Bar ${pos.n} of ${pos.total}` : 'Count-in')
  return (
    <div className="scapp" data-testid="score-sheet">
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
            <span>
              <b>
                {tl.meter.num}/{tl.meter.den}
              </b>
            </span>
          </span>
        </div>
        <NowNext m={m} />
        <ModeSeg name="lsmode" />
        <StandSwitch name="lstand" />
        <InstrumentSeg name="linst2" />
        <LoopButton tl={tl} />
        <LiveSyncBadge />
      </header>
      <ScoreView tl={tl} m={m} settings={settings} />
    </div>
  )
}
