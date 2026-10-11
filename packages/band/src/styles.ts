// Band styles (sketch: Swing, Bossa, Ballad, Funk, Waltz; plus Pop, since popular songs come first, D-36, and a
// Drone for long-tone drills). iReal's style names map onto them by keyword.

export type BandStyle = 'swing' | 'ballad' | 'bossa' | 'waltz' | 'pop' | 'funk' | 'drone'

export const BAND_STYLES: BandStyle[] = ['swing', 'ballad', 'bossa', 'waltz', 'pop', 'funk']

export const STYLE_LABEL: Record<BandStyle, string> = {
  swing: 'Swing',
  ballad: 'Ballad',
  bossa: 'Bossa',
  waltz: 'Waltz',
  pop: 'Pop',
  funk: 'Funk',
  drone: 'Drone',
}

/** A default tempo per style when the chart gives none. */
export const STYLE_BPM: Record<BandStyle, number> = {
  swing: 140,
  ballad: 66,
  bossa: 140,
  waltz: 150,
  pop: 100,
  funk: 96,
  drone: 60,
}

/** The band style for a chart's style text (iReal: "Medium Swing", "Bossa Nova", "Rock Pop"…) and meter. */
export function styleFor(style: string | undefined, meterNum = 4): BandStyle {
  const s = (style ?? '').toLowerCase()
  if (/drone/.test(s)) return 'drone'
  if (meterNum === 3 || meterNum === 6 || /waltz/.test(s)) return 'waltz'
  if (/bossa|samba|latin|bolero|mpb|choro|afox|bai[aã]o|son\b|salsa|tango|xote|forro|marchinha|chacarera|afro|cha/.test(s))
    return 'bossa'
  if (/funk|disco|r'?n'?b|soul(?! ballad)|reggae|electro/.test(s)) return 'funk'
  if (/ballad|slow(?! (rock|blues|shuffle|swing))/.test(s)) return 'ballad'
  if (/pop|rock|even|country|folk/.test(s)) return 'pop'
  return 'swing'
}

/**
 * Where the off-beat eighth falls, as a fraction of the beat: 2/3 is a triplet swing, flattening towards straight
 * eighths at fast tempos as players do. Straight styles return 0.5.
 */
export function swingAt(style: BandStyle, bpm: number): number {
  if (style !== 'swing' && style !== 'waltz' && style !== 'ballad') return 0.5
  if (bpm >= 260) return 0.55
  if (bpm <= 120) return 2 / 3
  return 2 / 3 - ((bpm - 120) / 140) * (2 / 3 - 0.55)
}
