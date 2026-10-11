// Two-octave keyboard (the sketch's kb()): tinted keys are the scale; dots mark the highlighted notes (chord tones
// or the pentatonic), steel dots the guide tones, rust dots the changed notes. Labels: chord slot or key degree.
import { note, pc } from '@mq/theory'
import { memo, type ReactNode } from 'react'
import type { PlayNote } from './play'

const NAT = [0, 2, 4, 5, 7, 9, 11]
const BLACK: Array<[number, number]> = [
  [0, 1],
  [1, 3],
  [3, 6],
  [4, 8],
  [5, 10],
]

export const Keyboard = memo(function Keyboard({ notes, w, h }: { notes: PlayNote[]; w: number; h: number }) {
  const ww = w / 14
  const bw = ww * 0.62
  const bh = h * 0.6
  const inScale = new Set(notes.map((n) => pc(note(n.name))))
  const label: Record<number, [string, string]> = {}
  for (const n of notes) if (n.role && n.label) label[pc(note(n.name))] ??= [n.label, n.role]
  const out: ReactNode[] = []
  let k = 0
  const dot = (cx: number, cy: number, r: number, [lab, role]: [string, string]) => {
    out.push(<circle key={k++} className={`kdot ${role}`} cx={cx} cy={cy} r={r} />)
    out.push(
      <text key={k++} className="ktx" x={cx} y={cy} fontSize={(r * 1.15).toFixed(1)}>
        {lab}
      </text>,
    )
  }
  for (let o = 0; o < 2; o++)
    for (let i = 0; i < 7; i++) {
      const p = NAT[i]!
      const x = (o * 7 + i) * ww
      out.push(<rect key={k++} className={`kw${inScale.has(p) ? ' in' : ''}`} x={x + 0.5} y={0.5} width={ww - 1} height={h - 1} rx={3} />)
      if (label[p]) dot(x + ww / 2, h - ww * 0.5, ww * 0.3, label[p])
    }
  for (let o = 0; o < 2; o++)
    for (const [i, p] of BLACK) {
      const x = (o * 7 + i + 1) * ww - bw / 2
      out.push(<rect key={k++} className={`kbk${inScale.has(p) ? ' in' : ''}`} x={x} y={0.5} width={bw} height={bh} rx={2} />)
      if (label[p]) dot(x + bw / 2, bh - bw * 0.62, bw * 0.38, label[p])
    }
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={`Keyboard: ${notes.map((n) => n.name).join(' ')}`}>
      {out}
    </svg>
  )
})
