// Accidentals drawn as paths rather than font glyphs: a font's ♯ sits wherever its metrics put it, and Safari on the
// iPhone placed Noto Music's half a staff space low (on the note below). A path is centred on its line or space by
// construction. `x` is the right edge (where the notehead's room begins), `y` the line or space, `s` a staff space.
import type { ReactNode } from 'react'

function sharp(x: number, y: number, s: number): ReactNode {
  const l = x - 0.62 * s
  const r = x - 0.26 * s
  const w = x - 0.88 * s
  return (
    <>
      <path className="acc-v" d={`M${l} ${y - 1.25 * s}V${y + 1.35 * s}M${r} ${y - 1.35 * s}V${y + 1.25 * s}`} strokeWidth={0.11 * s} />
      <path
        className="acc-b"
        d={`M${w} ${y - 0.32 * s}L${x} ${y - 0.62 * s}M${w} ${y + 0.62 * s}L${x} ${y + 0.32 * s}`}
        strokeWidth={0.3 * s}
      />
    </>
  )
}

function flat(x: number, y: number, s: number): ReactNode {
  const l = x - 0.72 * s
  return (
    <>
      <path className="acc-v" d={`M${l} ${y - 1.75 * s}V${y + 0.55 * s}`} strokeWidth={0.12 * s} />
      <path
        className="acc-f"
        d={`M${l} ${y + 0.55 * s}C${x + 0.1 * s} ${y + 0.05 * s} ${x - 0.05 * s} ${y - 0.75 * s} ${l} ${y - 0.12 * s}`}
        strokeWidth={0.2 * s}
      />
    </>
  )
}

function natural(x: number, y: number, s: number): ReactNode {
  const l = x - 0.66 * s
  const r = x - 0.18 * s
  return (
    <>
      <path className="acc-v" d={`M${l} ${y - 1.35 * s}V${y + 0.62 * s}M${r} ${y - 0.62 * s}V${y + 1.35 * s}`} strokeWidth={0.11 * s} />
      <path className="acc-b" d={`M${l} ${y - 0.3 * s}L${r} ${y - 0.5 * s}M${l} ${y + 0.5 * s}L${r} ${y + 0.3 * s}`} strokeWidth={0.28 * s} />
    </>
  )
}

function doubleSharp(x: number, y: number, s: number): ReactNode {
  const c = x - 0.45 * s
  const d = 0.36 * s
  return <path className="acc-b" d={`M${c - d} ${y - d}L${c + d} ${y + d}M${c - d} ${y + d}L${c + d} ${y - d}`} strokeWidth={0.2 * s} />
}

/** One accidental: ♯ ♭ ♮ 𝄪 𝄫 (anything else draws nothing); `sig` marks one in a key signature. */
export function Accidental({ glyph, x, y, s, flag, sig }: { glyph: string; x: number; y: number; s: number; flag?: boolean; sig?: boolean }) {
  let body: ReactNode = null
  if (glyph === '♯') body = sharp(x, y, s)
  else if (glyph === '♭') body = flat(x, y, s)
  else if (glyph === '♮') body = natural(x, y, s)
  else if (glyph === '𝄪') body = doubleSharp(x, y, s)
  else if (glyph === '𝄫')
    body = (
      <>
        {flat(x - 0.75 * s, y, s)}
        {flat(x, y, s)}
      </>
    )
  if (!body) return null
  return <g className={`acc-g${flag ? ' flag' : ''}${sig ? ' sig' : ''}`}>{body}</g>
}

/** Room an accidental takes left of its x, in staff spaces. */
export const accWidth = (glyph: string): number => (glyph === '𝄫' ? 1.7 : glyph ? 0.95 : 0)
