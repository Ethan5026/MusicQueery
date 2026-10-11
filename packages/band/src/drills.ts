// Drills (D-12): progressions that move through every key, built as charts from a template in C, so the band, the
// exact timeline and every screen treat them like any tune. The first key is the user's; the rest follow the
// circle of fifths (up a fourth each time), spelled the usual way for each key.
import type { Bar, Chart, KeySig } from '@mq/model'
import { mod, note, pc, transposeChart } from '@mq/theory'
import { sheet } from './sheet'

const MAJOR_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
const MINOR_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B']

/** Twelve tonics up a fourth at a time from `start`. */
export function cycleOfKeys(start: string, mode: 'major' | 'minor'): string[] {
  const names = mode === 'minor' ? MINOR_NAMES : MAJOR_NAMES
  const p = pc(note(start))
  return Array.from({ length: 12 }, (_, i) => names[mod(p + 5 * i, 12)]!)
}

export interface DrillDef {
  id: string
  title: string
  sub: string
  mode: 'major' | 'minor'
  style: string
  tempo: number
  /** default first key */
  key: string
  build: (start: string) => Chart
}

/** One template (in C) played in each of the twelve keys in turn, each key a section named after it. */
function allKeys(d: Omit<DrillDef, 'build'>, template: string, meterNum = 4): DrillDef {
  return {
    ...d,
    build: (start) => {
      const base = sheet({ id: d.id, title: d.title, key: { tonic: 'C', mode: d.mode }, style: d.style, tempo: d.tempo, meter: { num: meterNum, den: 4 } }, template)
      const bars: Bar[] = []
      for (const k of cycleOfKeys(start, d.mode)) {
        const t = transposeChart(base, k)
        t.bars.forEach((b, i) => {
          const rest = { ...b }
          delete rest.section
          bars.push(i === 0 ? { ...rest, section: d.mode === 'minor' ? `${k} minor` : k } : rest)
        })
      }
      const key: KeySig = { tonic: cycleOfKeys(start, d.mode)[0]!, mode: d.mode }
      return { ...base, id: `drill-${d.id}-${key.tonic}`, key, bars }
    },
  }
}

/** A template in C transposed as a whole to `start` (no key cycle). */
function oneKey(d: Omit<DrillDef, 'build'>, template: string, meterNum = 4, choruses = 4): DrillDef {
  return {
    ...d,
    build: (start) => {
      const base = sheet({ id: d.id, title: d.title, key: { tonic: 'C', mode: d.mode }, style: d.style, tempo: d.tempo, meter: { num: meterNum, den: 4 }, choruses }, template)
      const t = transposeChart(base, start)
      return { ...t, id: `drill-${d.id}-${t.key.tonic}` }
    },
  }
}

export const DRILLS: DrillDef[] = [
  allKeys(
    { id: 'major-251', title: 'Major ii–V–I, all 12 keys', sub: 'Around the circle of fifths · 4 bars a key', mode: 'major', style: 'Medium Swing', tempo: 120, key: 'C' },
    'Dm7 | G7 | Cmaj7 | Cmaj7',
  ),
  allKeys(
    { id: 'minor-251', title: 'Minor ii–V–i, all 12 keys', sub: 'Around the circle of fifths · 4 bars a key', mode: 'minor', style: 'Medium Swing', tempo: 120, key: 'C' },
    'Dm7b5 | G7b9 | Cm6 | Cm6',
  ),
  allKeys(
    { id: 'blues-12', title: '12-bar blues, all 12 keys', sub: 'Up a 4th each chorus', mode: 'major', style: 'Medium Swing', tempo: 132, key: 'F' },
    'C7 | F7 | C7 | Gm7 C7 | F7 | F#dim7 | C7 | A7 | Dm7 | G7 | C7 A7 | Dm7 G7',
  ),
  allKeys(
    { id: 'turnarounds', title: 'Turnarounds: I–vi–ii–V', sub: 'Diatonic, tritone-sub and back-door versions', mode: 'major', style: 'Medium Swing', tempo: 132, key: 'B♭' },
    'Cmaj7 Am7 | Dm7 G7 | Cmaj7 Eb7 | Ab7 Db7 | Cmaj7 A7 | Dm7 G7 | Cmaj7 | Fm7 Bb7',
  ),
  oneKey(
    { id: 'coltrane', title: 'Coltrane changes', sub: 'Three key centres a major third apart', mode: 'major', style: 'Medium Up Swing', tempo: 160, key: 'C' },
    `[1] Dm7 Eb7 | Abmaj7 B7 | Emaj7 G7 | Cmaj7 |
     [2] Bbm7 B7 | Emaj7 G7 | Cmaj7 Eb7 | Abmaj7 |
     [3] F#m7 G7 | Cmaj7 Eb7 | Abmaj7 B7 | Emaj7`,
  ),
  oneKey(
    { id: 'modal', title: 'Modal vamps', sub: 'Dorian, Mixolydian, Lydian · 16 bars each', mode: 'major', style: 'Even 8ths', tempo: 108, key: 'D' },
    `[Dorian] Cm7 | Cm7 | Cm7 | Cm7 | Cm7 | Cm7 | Cm7 | Cm7 | Dm7/C | Dm7/C | Cm7 | Cm7 | Dm7/C | Dm7/C | Cm7 | Cm7 |
     [Mixolydian] C7 | C7 | Bb/C | Bb/C | C7 | C7 | Bb/C | Bb/C | C7 | C7 | Bb/C | Bb/C | C7 | C7 | Bb/C | Bb/C |
     [Lydian] Cmaj7#11 | Cmaj7#11 | D/C | D/C | Cmaj7#11 | Cmaj7#11 | D/C | D/C | Cmaj7#11 | Cmaj7#11 | D/C | D/C | Cmaj7#11 | Cmaj7#11 | D/C | D/C`,
    4,
    2,
  ),
  oneKey(
    { id: 'drone', title: 'Drone for long tones', sub: 'Any key · tuning reference A = 440', mode: 'major', style: 'Drone', tempo: 60, key: 'B♭' },
    '[Drone] C5 | C5 | C5 | C5 | C5 | C5 | C5 | C5',
    4,
    16,
  ),
]

export const drillById = (id: string): DrillDef | undefined => DRILLS.find((d) => d.id === id)
