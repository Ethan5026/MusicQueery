// Scales and the three lenses (D-06): Inside, Bebop, Colour. The first seven chord types and the
// 17 scales come from the sketch; the rest extends them to the full chord grammar.
import { type Chord, family, requiredPcs } from './chord'
import { type Note, mod, pc, spell } from './pitch'

export type ScaleId =
  | 'major' | 'lydian' | 'mixolydian' | 'dorian' | 'aeolian' | 'phrygian' | 'locrian' | 'locrian2'
  | 'phrygdom' | 'whole' | 'dim' | 'bebopMaj' | 'bebopDom' | 'bebopDor' | 'melmin' | 'lyddom' | 'altered'
  | 'hwdim' | 'mixb6' | 'lydaug' | 'harmmin'

export type Lens = 'inside' | 'bebop' | 'colour'
export const LENSES: Lens[] = ['inside', 'bebop', 'colour']

interface ScaleDef {
  name: string
  semis: number[]
  /** letter step for each degree (spelling); default 0..6 */
  steps?: number[]
}

export const SCALES: Record<ScaleId, ScaleDef> = {
  major: { name: 'major', semis: [0, 2, 4, 5, 7, 9, 11] },
  lydian: { name: 'Lydian', semis: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', semis: [0, 2, 4, 5, 7, 9, 10] },
  dorian: { name: 'Dorian', semis: [0, 2, 3, 5, 7, 9, 10] },
  aeolian: { name: 'Aeolian', semis: [0, 2, 3, 5, 7, 8, 10] },
  phrygian: { name: 'Phrygian', semis: [0, 1, 3, 5, 7, 8, 10] },
  locrian: { name: 'Locrian', semis: [0, 1, 3, 5, 6, 8, 10] },
  locrian2: { name: 'Locrian ♮2', semis: [0, 2, 3, 5, 6, 8, 10] },
  phrygdom: { name: 'Phrygian dominant', semis: [0, 1, 4, 5, 7, 8, 10] },
  whole: { name: 'whole tone', semis: [0, 2, 4, 6, 8, 10], steps: [0, 1, 2, 3, 4, 6] },
  dim: { name: 'diminished', semis: [0, 2, 3, 5, 6, 8, 9, 11], steps: [0, 1, 2, 3, 4, 5, 5, 6] },
  bebopMaj: { name: 'major bebop', semis: [0, 2, 4, 5, 7, 8, 9, 11], steps: [0, 1, 2, 3, 4, 5, 5, 6] },
  bebopDom: { name: 'dominant bebop', semis: [0, 2, 4, 5, 7, 9, 10, 11], steps: [0, 1, 2, 3, 4, 5, 6, 6] },
  bebopDor: { name: 'Dorian bebop', semis: [0, 2, 3, 4, 5, 7, 9, 10], steps: [0, 1, 2, 2, 3, 4, 5, 6] },
  melmin: { name: 'melodic minor', semis: [0, 2, 3, 5, 7, 9, 11] },
  lyddom: { name: 'Lydian dominant', semis: [0, 2, 4, 6, 7, 9, 10] },
  // Spelled as the chord's alterations (C D♭ D♯ E F♯ A♭ B♭), not the sketch's C D♭ E♭ F♭ G♭ A♭ B♭,
  // so the 3rd on the staff matches the chord's 3rd.
  altered: { name: 'altered', semis: [0, 1, 3, 4, 6, 8, 10], steps: [0, 1, 1, 2, 3, 5, 6] },
  hwdim: { name: 'half-whole diminished', semis: [0, 1, 3, 4, 6, 7, 9, 10], steps: [0, 1, 1, 2, 3, 4, 5, 6] },
  mixb6: { name: 'Mixolydian ♭6', semis: [0, 2, 4, 5, 7, 8, 10] },
  lydaug: { name: 'Lydian augmented', semis: [0, 2, 4, 6, 8, 9, 11] },
  harmmin: { name: 'harmonic minor', semis: [0, 2, 3, 5, 7, 8, 11] },
}

export function scaleNotes(root: Note, id: ScaleId): Note[] {
  const def = SCALES[id]
  return def.semis.map((s, i) => spell(root.letter + (def.steps?.[i] ?? i), pc(root) + s))
}

export interface ScaleContext {
  /** Semitones from the region's major tonic (relative major for minor keys) to the chord root. */
  degree: number
  /** The following chord, if any. */
  next: Chord | null
}

const nextIsMinor = (next: Chord | null): boolean => {
  const f = next ? family(next) : null
  return f === 'min' || f === 'half'
}

function candidates(c: Chord, ctx: ScaleContext, lens: Lens): ScaleId[] {
  const f = family(c)
  const d = mod(ctx.degree, 12)
  const nm = nextIsMinor(ctx.next)
  const insideMaj: ScaleId[] =
    c.fifth === '#' ? ['lydaug'] : c.seventh === 'none' ? ['major', 'lydian'] : d === 5 ? ['lydian', 'major'] : ['major', 'lydian']
  const insideMin: ScaleId[] =
    c.seventh === 'maj'
      ? ['melmin', 'harmmin']
      : c.seventh === 'six'
        ? ['dorian', 'melmin']
        : d === 9 || d === 4
          ? [d === 9 ? 'aeolian' : 'phrygian', 'aeolian', 'dorian', 'phrygian', 'melmin', 'harmmin']
          : ['dorian', 'aeolian', 'phrygian', 'melmin', 'harmmin']
  const insideDom: ScaleId[] = c.alt
    ? ['altered']
    : c.fifth === '#'
      ? ['whole', 'altered']
      : c.third === 'sus4' || c.third === 'sus2'
        ? ['mixolydian', 'phrygian', 'dorian']
        : nm
          ? ['phrygdom', 'mixolydian', 'hwdim', 'lyddom', 'altered', 'mixb6']
          : ['mixolydian', 'lyddom', 'hwdim', 'mixb6', 'phrygdom', 'altered']
  const inside: Record<typeof f, ScaleId[]> = {
    maj: insideMaj,
    min: insideMin,
    dom: insideDom,
    half: ['locrian', 'locrian2'],
    dim: ['dim', 'locrian'],
    aug: ['whole', 'lydaug'],
    sus: ['mixolydian', 'major'],
    power: ['major', 'mixolydian', 'dorian'],
  }
  if (lens === 'inside') return inside[f]
  if (lens === 'bebop') {
    const first: Partial<Record<typeof f, ScaleId>> = {
      maj: 'bebopMaj', min: 'bebopDor', dom: 'bebopDom', half: 'locrian2', dim: 'dim', aug: 'whole', sus: 'bebopDom',
    }
    const b = first[f]
    return b ? [b, ...inside[f]] : inside[f]
  }
  const colour: Record<typeof f, ScaleId[]> = {
    maj: c.fifth === '#' ? ['lydaug'] : ['lydian', ...insideMaj],
    min: ['melmin', ...insideMin],
    dom: c.alt
      ? ['altered']
      : c.fifth === '#'
        ? ['altered', 'whole']
        : c.third === 'sus4' || c.third === 'sus2'
          ? ['mixolydian', 'phrygian']
          : nm
            ? ['altered', 'lyddom', 'hwdim', ...insideDom]
            : ['lyddom', 'hwdim', 'altered', ...insideDom],
    half: ['locrian2', 'locrian'],
    dim: ['dim'],
    aug: ['whole', 'lydaug'],
    sus: ['mixolydian'],
    power: inside.power,
  }
  return colour[f]
}

const fits = (id: ScaleId, req: number[]): boolean => req.every((p) => SCALES[id].semis.includes(p))

/**
 * Picks the lens's scale for a chord. The first candidate that holds the chord's tones wins: Inside and Bebop
 * need every chord tone, Colour may replace the natural 5th and the 7th (the sketch's m7 → melodic minor).
 */
export function pickScale(c: Chord, ctx: ScaleContext, lens: Lens): ScaleId {
  const list = candidates(c, ctx, lens)
  const strict = lens !== 'colour'
  return (
    list.find((id) => fits(id, requiredPcs(c, strict))) ??
    list.find((id) => fits(id, requiredPcs(c, false))) ??
    list[0]!
  )
}
