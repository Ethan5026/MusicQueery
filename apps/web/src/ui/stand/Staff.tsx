// Treble staff (D-11), ported from the sketch's staffSVG(): the chord stacked as whole notes, a barline, then
// the scale ascending through the octave with names underneath. Every accidental written; no key signature.
// Note colours come from the Play mode (play.ts): brass, steel (guide tones), rust (changed notes).
import type { Slot } from '@mq/theory'
import { memo, type ReactNode } from 'react'
import { Accidental } from './accidentals'
import type { PlayNote } from './play'

export interface Tone {
  name: string
  slot: Slot
}

const LET = 'CDEFGAB'
const dbl = (s: string): string => s.replace(/♯♯/g, '𝄪').replace(/♭♭/g, '𝄫')

interface Placed {
  n: string
  /** diatonic staff position: 28 = middle C, 30 = bottom line E */
  p: number
  a: string
}

/** Stacks notes upwards from middle C; `strict` never lets two share a position (chords). */
function place(ns: string[], strict: boolean): Placed[] {
  let prev = -99
  return ns.map((n, i) => {
    let p = 28 + LET.indexOf(n[0]!)
    if (i > 0) while (strict ? p <= prev : p < prev) p += 7
    prev = p
    return { n, p, a: n.slice(1) }
  })
}

interface Props {
  /** stacked before the barline; null for a scale alone */
  chord: Tone[] | null
  notes: PlayNote[]
  /** staff space in px */
  s: number
  /** gap between scale notes */
  g: number
  octave: boolean
  names: boolean
}

export const Staff = memo(function Staff({ chord, notes, s, g, octave, names }: Props) {
  const half = s / 2
  const botY = 6 * s + 4
  const h = botY + 2 * s + (names ? s * 2.2 : 4)
  const Y = (p: number): number => botY - (p - 30) * half
  const rx = s * 0.64
  const ry = s * 0.46
  const acW = s * 1.1
  const out: ReactNode[] = []
  let k = 0

  const ledgers = (x: number, p: number, r: number) => {
    const ys: number[] = []
    for (let q = 28; q >= p; q -= 2) ys.push(Y(q))
    for (let q = 40; q <= p; q += 2) ys.push(Y(q))
    return ys.map((y) => <line key={k++} className="st-led" x1={x - r - 3} x2={x + r + 3} y1={y} y2={y} />)
  }
  const accidental = (x: number, y: number, a: string) => (a ? <Accidental key={k++} glyph={dbl(a)} x={x} y={y} s={s} /> : null)

  // the chord, stacked
  const clefW = s * 3.3
  const cp = place(
    (chord ?? []).map((t) => t.name),
    true,
  )
  const cx = clefW + 2 * acW + rx + 6
  let col = 0
  for (const c of [...cp].reverse()) {
    if (c.a) {
      out.push(accidental(cx - rx * 1.2 - 2 - col * acW, Y(c.p), c.a))
      col = 1 - col
    }
  }
  for (const c of cp) {
    const y = Y(c.p)
    out.push(...ledgers(cx, c.p, rx * 1.2))
    out.push(<ellipse key={k++} className="wh" cx={cx} cy={y} rx={rx * 1.2} ry={ry * 1.1} />)
    out.push(
      <ellipse key={k++} className="wh-in" cx={cx} cy={y} rx={rx * 0.5} ry={ry * 0.72} transform={`rotate(55 ${cx} ${y})`} />,
    )
  }
  const bx = chord ? cx + rx * 1.2 + 8 : clefW - acW

  // the scale
  const seq = octave && notes.length ? [...notes, notes[0]!] : notes
  const sc = place(
    seq.map((n) => n.name),
    false,
  )
  const sx = bx + acW + rx + 6
  const last: Record<number, string> = {}
  sc.forEach((c, i) => {
    const x = sx + i * g
    const y = Y(c.p)
    const r = seq[i]!.role
    const a = !c.a && last[c.p] ? '♮' : c.a
    last[c.p] = c.a
    out.push(...ledgers(x, c.p, rx))
    out.push(accidental(x - rx - 2, y, a))
    out.push(<ellipse key={k++} className={`nh ${r}`} cx={x} cy={y} rx={rx} ry={ry} transform={`rotate(-20 ${x} ${y})`} />)
    if (names)
      out.push(
        <text key={k++} className={`st-nm ${r}`} x={x} y={(h - 3).toFixed(1)} fontSize={(s * 1.3).toFixed(1)}>
          {dbl(c.n)}
        </text>,
      )
  })
  const ex = sx + Math.max(0, sc.length - 1) * g + rx + 8
  const w = Math.ceil(ex + 3)
  const vbar = (x: number, cls: string) => <line className={cls} x1={x} x2={x} y1={botY - 4 * s} y2={botY} />
  return (
    <svg viewBox={`0 0 ${w} ${h.toFixed(1)}`} width={w} height={h.toFixed(1)} role="img" aria-label={`Treble staff: ${chord ? `chord ${chord.map((t) => t.name).join(' ')}, then ` : ''}scale ${notes.map((n) => n.name).join(' ')}`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={`l${i}`} className="st-line" x1={1} x2={ex} y1={botY - i * s} y2={botY - i * s} />
      ))}
      <text className="st-clef" x={1} y={(botY - s).toFixed(1)} fontSize={(s * 4.1).toFixed(1)}>
        𝄞
      </text>
      {out}
      {chord && vbar(bx, 'st-bar')}
      {vbar(ex - 4, 'st-bar')}
      {vbar(ex, 'st-end')}
    </svg>
  )
})
