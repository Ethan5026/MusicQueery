// What the Play card shows in each mode (M4, user request after the first phone test):
//  - simple: the scale of the key centre you're in (major or natural minor), its pentatonic highlighted.
//  - integrated: simple, plus callouts at moments that need more: a chord with notes outside the key
//    (the scale shown with those notes swapped in), and an upcoming key change (the new key previewed).
//  - advanced: the chord-scale for the current chord (lens), the chord stacked, guide tones (D-06, D-11).
import { type Moment, type MomentKey, note, noteName, pc, scaleNotes } from '@mq/theory'
import type { Tone } from './Staff'

export type PlayMode = 'simple' | 'integrated' | 'advanced'

/** '' plain · 't' brass (chord tone / pentatonic) · 'g' steel (guide tone) · 'x' rust (changed note) */
export type Role = '' | 't' | 'g' | 'x'

export interface PlayNote {
  name: string
  role: Role
  /** keyboard dot label: degree in the key, or the chord slot */
  label?: string
}

export interface Callout {
  kind: 'outside' | 'keychange'
  /** "C major, but F♯ over D7" / "E♭ major in 6 beats" */
  lead: string
  /** the notes that differ from the key you're in */
  changed: string[]
}

export interface PlayView {
  title: string
  sub: string
  /** stacked chord before the barline (advanced only) */
  chord: Tone[] | null
  notes: PlayNote[]
  callout: Callout | null
  /** the line under the staff */
  footer: 'guide' | 'tones' | 'pentatonic' | 'none'
}

const DEGREES = ['1', '2', '3', '4', '5', '6', '7']
/** Pentatonic degrees: major 1 2 3 5 6, minor 1 ♭3 4 5 ♭7 (indices into the 7-note scale). */
const PENT: Record<MomentKey['mode'], number[]> = { major: [0, 1, 2, 4, 5], minor: [0, 2, 3, 4, 6] }

export const keyScale = (k: MomentKey): string[] =>
  scaleNotes(note(k.tonic), k.mode === 'major' ? 'major' : 'aeolian').map((n) => noteName(n))

const pcOf = (n: string): number => pc(note(n))
const letter = (n: string): string => n[0]!

/** The key's scale with each note outside it swapped in on the same letter (F → F♯ for D7 in C). */
export function alterScale(scale: string[], outside: string[]): { notes: string[]; changed: string[] } {
  const notes = [...scale]
  const changed: string[] = []
  for (const o of outside) {
    let i = notes.findIndex((n) => letter(n) === letter(o))
    if (i < 0) {
      // spelled on a letter the scale already uses differently: replace the nearest note
      let best = 99
      notes.forEach((n, j) => {
        const d = Math.min((pcOf(n) - pcOf(o) + 12) % 12, (pcOf(o) - pcOf(n) + 12) % 12)
        if (d < best) [best, i] = [d, j]
      })
    }
    if (i >= 0 && notes[i] !== o) {
      notes[i] = o
      changed.push(o)
    }
  }
  return { notes, changed }
}

const keyTitle = (k: MomentKey): string => `${k.tonic} ${k.mode}`

function keyNotes(scale: string[], mode: MomentKey['mode'], changed: Set<string>): PlayNote[] {
  return scale.map((n, i) => ({
    name: n,
    role: changed.has(n) ? 'x' : PENT[mode].includes(i) ? 't' : '',
    label: DEGREES[i]!,
  }))
}

/** `preview: false` keeps the staff on the key you're in until the change (the landscape Next staff shows the new one). */
export function playView(m: Moment, mode: PlayMode, opts: { preview?: boolean } = {}): PlayView | null {
  if (mode === 'advanced' || !m.key) {
    if (!m.scale) return null
    const chord = m.tones.map((t) => ({ name: t.name, slot: t.slot }))
    const role = (n: string): Role => {
      const t = m.tones.find((x) => pcOf(x.name) === pcOf(n))
      return !t ? '' : t.slot === '3' || t.slot === '7' ? 'g' : 't'
    }
    const label = (n: string) => m.tones.find((x) => pcOf(x.name) === pcOf(n))?.slot
    return {
      title: `${m.scale.root} ${m.scale.name}`,
      sub: '',
      chord,
      notes: m.scale.notes.map((n) => ({ name: n, role: role(n), ...(label(n) ? { label: label(n)! } : {}) })),
      callout: null,
      footer: m.guide ? 'guide' : m.tones.length ? 'tones' : 'none',
    }
  }

  const k = m.key
  const scale = keyScale(k)
  const base: PlayView = {
    title: keyTitle(k),
    sub: `${k.tonic} ${k.mode} pentatonic`,
    chord: null,
    notes: keyNotes(scale, k.mode, new Set()),
    callout: null,
    footer: 'pentatonic',
  }
  if (mode === 'simple') return base

  // integrated: an upcoming key change first (within two bars of 4/4), then a chord outside the key
  const kc = m.keyChange
  if (kc && kc.inBeats <= 8) {
    const next = keyScale(kc.to)
    const changed = next.filter((n) => !scale.includes(n))
    const soon = kc.inBeats <= 4 && opts.preview !== false
    return {
      ...base,
      // in the last bar the staff already shows the new key
      ...(soon ? { title: keyTitle(kc.to), sub: `${kc.to.tonic} ${kc.to.mode} pentatonic`, notes: keyNotes(next, kc.to.mode, new Set(changed)) } : {}),
      callout: { kind: 'keychange', lead: `${keyTitle(kc.to)} in ${kc.inBeats} beat${kc.inBeats === 1 ? '' : 's'}`, changed },
    }
  }
  const outside = m.tones.map((t) => t.name).filter((n) => !scale.some((s) => pcOf(s) === pcOf(n)))
  if (outside.length && m.chord) {
    const { notes, changed } = alterScale(scale, outside)
    return {
      ...base,
      notes: keyNotes(notes, k.mode, new Set(changed)),
      callout: { kind: 'outside', lead: `${keyTitle(k)}, but`, changed },
    }
  }
  return base
}
