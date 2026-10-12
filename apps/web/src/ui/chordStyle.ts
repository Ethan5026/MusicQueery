// Chord style setting (sketch "Settings that change the chart"): Real Book text (maj7, m7, m7♭5) or symbols
// (Δ7, –7, ø7). Only the quality changes; stored and analysed chords stay canonical text (D-29).
export type ChordStyle = 'text' | 'symbols'

export function styleQuality(q: string, style: ChordStyle): string {
  if (style === 'text') return q
  let m: RegExpMatchArray | null
  if ((m = q.match(/^m7♭5(.*)$/))) return `ø7${m[1]}`
  if ((m = q.match(/^mMaj(\d+)(.*)$/))) return `–Δ${m[1]}${m[2]}`
  if ((m = q.match(/^maj(\d+)(.*)$/))) return `Δ${m[1]}${m[2]}`
  if ((m = q.match(/^m(?!aj)(.*)$/))) return `–${m[1]}`
  return q
}
