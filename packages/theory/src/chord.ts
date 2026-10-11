// Chord grammar: parse symbols (lead-sheet, Unicode or iReal style) into a structure, format them
// canonically, and list their tones. format(parse(s)) is canonical and parse(format(c)) == c.
import {
  type Interval,
  type Note,
  accidentalText,
  noteName,
  pc,
  readAccidental,
  LETTERS,
  sameNote,
  transpose,
} from './pitch'

export type Third = 'maj' | 'min' | 'sus4' | 'sus2' | 'none'
export type Fifth = 'p' | 'b' | '#'
export type Seventh = 'none' | 'min' | 'maj' | 'dim' | 'six'
export type Family = 'maj' | 'min' | 'dom' | 'half' | 'dim' | 'aug' | 'sus' | 'power'

export interface Tension {
  deg: 9 | 11 | 13
  acc: -1 | 0 | 1
}

export interface Chord {
  kind: 'chord'
  root: Note
  bass: Note | null
  third: Third
  fifth: Fifth
  seventh: Seventh
  /** Sorted by degree, then accidental. */
  tensions: Tension[]
  /** 7alt: ♭9 ♯9 ♯11 ♭13 implied */
  alt: boolean
  /** sus chord that also keeps the 3rd (iReal 7susadd3) */
  add3: boolean
}

export interface NoChord {
  kind: 'nc'
}

export type ChordSymbol = Chord | NoChord

export const NC: NoChord = { kind: 'nc' }

// ---------------------------------------------------------------- parse

/** Tokens tried in order at each position of the quality text (after normalising). */
type Tok =
  | 'maj' | 'min' | 'dim' | 'half' | 'aug' | 'sus4' | 'sus2' | 'alt' | 'add3' | 'no3'
  | '69' | '6' | '7' | '9' | '11' | '13' | '5' | '2'
  | 'addTension' | 'alter' | 'b6'

const TOKENS: Array<[RegExp, Tok]> = [
  [/^(?:maj|Maj|MAJ|ma(?=\d)|MA|M|Δ|△|\^)/, 'maj'],
  [/^(?:min|mi|m|-|−)(?!aj)/, 'min'],
  [/^(?:no3|omit3)/, 'no3'],
  [/^(?:dim|°|o)/, 'dim'],
  [/^(?:ø|h)/, 'half'],
  [/^(?:aug|\+)/, 'aug'],
  [/^sus2/, 'sus2'],
  [/^sus4?/, 'sus4'],
  [/^alt(?:ered)?/, 'alt'],
  [/^add3/, 'add3'],
  [/^add(?:[b#]?(?:9|11|13|2|4|6))/, 'addTension'],
  [/^(?:6\/9|69)/, '69'],
  [/^[b#](?:5|9|11|13|4)/, 'alter'],
  [/^b6/, 'b6'],
  [/^13/, '13'],
  [/^11/, '11'],
  [/^9/, '9'],
  [/^7/, '7'],
  [/^6/, '6'],
  [/^5/, '5'],
  [/^2/, '2'],
]

function normaliseQuality(q: string): string {
  return q
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .replace(/[()[\],\s]/g, '')
}

function addTension(ts: Tension[], deg: 9 | 11 | 13, acc: -1 | 0 | 1): void {
  // An altered degree replaces the natural one (13♭9); two alterations can coexist (7♭9♯9).
  if (acc !== 0) {
    const i = ts.findIndex((t) => t.deg === deg && t.acc === 0)
    if (i >= 0) ts.splice(i, 1)
  } else if (ts.some((t) => t.deg === deg)) return
  if (!ts.some((t) => t.deg === deg && t.acc === acc)) ts.push({ deg, acc })
}

function sortTensions(ts: Tension[]): Tension[] {
  return ts.sort((a, b) => a.deg - b.deg || a.acc - b.acc)
}

const DEG_OF: Record<string, 9 | 11 | 13> = { '9': 9, '2': 9, '11': 11, '4': 11, '13': 13, '6': 13 }

function parseQuality(qRaw: string): Omit<Chord, 'kind' | 'root' | 'bass'> | null {
  const q = normaliseQuality(qRaw)
  let third: Third = 'maj'
  let fifth: Fifth = 'p'
  let seventh: Seventh = 'none'
  const ts: Tension[] = []
  let alt = false
  let add3 = false
  let majFlag = false
  let dimFlag = false
  let numberSeen = false
  let power = false
  let i = 0
  const setExt = (n: 7 | 9 | 11 | 13): void => {
    numberSeen = true
    seventh = majFlag ? 'maj' : dimFlag ? 'dim' : 'min'
    if (n >= 9) addTension(ts, 9, 0)
    if (n === 11) addTension(ts, 11, 0)
    if (n === 13) {
      if (third === 'min') addTension(ts, 11, 0)
      addTension(ts, 13, 0)
    }
  }
  while (i < q.length) {
    const rest = q.slice(i)
    let hit: [string, Tok] | null = null
    for (const [re, tok] of TOKENS) {
      const m = re.exec(rest)
      if (m) {
        hit = [m[0], tok]
        break
      }
    }
    if (!hit) return null
    const [text, tok] = hit
    switch (tok) {
      case 'maj':
        if (majFlag || numberSeen) return null
        majFlag = true
        break
      case 'min':
        if (i !== 0) return null
        third = 'min'
        break
      case 'dim':
        if (i !== 0) return null
        third = 'min'
        fifth = 'b'
        dimFlag = true
        break
      case 'half':
        if (i !== 0) return null
        third = 'min'
        fifth = 'b'
        seventh = 'min'
        break
      case 'aug':
        if (numberSeen || i === 0) fifth = '#'
        else return null
        break
      case 'sus4':
        third = 'sus4'
        break
      case 'sus2':
        third = 'sus2'
        break
      case 'alt':
        alt = true
        if (seventh === 'none') seventh = 'min'
        numberSeen = true
        break
      case 'add3':
        add3 = true
        break
      case 'no3':
        third = 'none'
        break
      case 'addTension': {
        const body = text.slice(3)
        const acc = body[0] === 'b' ? -1 : body[0] === '#' ? 1 : 0
        const num = body.replace(/^[b#]/, '')
        if (num === '6' && acc === 0) {
          if (seventh !== 'none') return null
          seventh = 'six'
        } else addTension(ts, DEG_OF[num] ?? 9, acc)
        break
      }
      case '69':
        if (numberSeen) return null
        numberSeen = true
        seventh = 'six'
        addTension(ts, 9, 0)
        break
      case 'alter': {
        const acc = text[0] === 'b' ? -1 : 1
        const num = text.slice(1)
        if (num === '5') {
          if (fifth !== 'p') return null
          fifth = acc < 0 ? 'b' : '#'
        } else addTension(ts, DEG_OF[num] ?? 9, acc)
        break
      }
      case 'b6':
        addTension(ts, 13, -1)
        break
      case '13':
      case '11':
      case '9':
      case '7':
        if (!numberSeen) setExt(Number(tok) as 7 | 9 | 11 | 13)
        else if (tok === '7') return null
        else addTension(ts, DEG_OF[tok] ?? 9, 0) // 7(13): a bare number after the 7th is a tension
        break
      case '6':
        if (numberSeen) {
          if (seventh === 'none') return null
          addTension(ts, 13, 0)
          break
        }
        numberSeen = true
        seventh = 'six'
        break
      case '5':
        if (i !== 0 || q.length !== 1) return null
        power = true
        break
      case '2':
        if (numberSeen) return null
        addTension(ts, 9, 0)
        break
    }
    i += text.length
  }
  if (majFlag && !numberSeen) {
    // C^ / CΔ / Cmaj alone: major seventh (iReal's triangle); CM alone is a plain triad
    if (/^(?:M)$/.test(q)) majFlag = false
    else seventh = 'maj'
  }
  if (power) {
    third = 'none'
  }
  if (add3 && third !== 'sus4' && third !== 'sus2') return null
  return { third, fifth, seventh, tensions: sortTensions(ts), alt, add3 }
}

const NOTE_RE = /^([A-G])(𝄫|𝄪|♭♭|♯♯|♭|♯|b|#)?/

/** Parses a chord symbol. Returns null if the symbol isn't understood. */
export function parseChord(symbol: string): ChordSymbol | null {
  const s = symbol.trim()
  if (/^(?:N\.?C\.?|NC|n)$/i.test(s)) return NC
  const m = NOTE_RE.exec(s)
  if (!m) return null
  const root: Note = { letter: LETTERS.indexOf(m[1]!), acc: readAccidental(m[2] ?? '')[0] }
  let rest = s.slice(m[0].length)
  let bass: Note | null = null
  const slash = /\/([A-G])(𝄫|𝄪|♭♭|♯♯|♭|♯|b|#)?$/.exec(rest)
  if (slash) {
    bass = { letter: LETTERS.indexOf(slash[1]!), acc: readAccidental(slash[2] ?? '')[0] }
    rest = rest.slice(0, slash.index)
  }
  const q = parseQuality(rest)
  if (!q) return null
  if (bass && sameNote(bass, root)) bass = null
  return { kind: 'chord', root, bass, ...q }
}

/** parseChord that throws, for literals in code and tests. */
export function chord(symbol: string): Chord {
  const c = parseChord(symbol)
  if (!c || c.kind !== 'chord') throw new Error(`bad chord symbol: ${symbol}`)
  return c
}

// ---------------------------------------------------------------- classify

export function family(c: Chord): Family {
  if (c.third === 'none') return 'power'
  if (c.third === 'sus4' || c.third === 'sus2') return c.seventh === 'min' ? 'dom' : c.seventh === 'none' ? 'sus' : 'maj'
  if (c.third === 'maj') {
    if (c.seventh === 'min' || c.alt) return 'dom'
    if (c.seventh === 'dim') return 'dim'
    return c.fifth === '#' && c.seventh === 'none' ? 'aug' : 'maj'
  }
  if (c.fifth === 'b') return c.seventh === 'min' ? 'half' : 'dim'
  return 'min'
}

const has = (c: Chord, deg: number, acc: number): boolean => c.tensions.some((t) => t.deg === deg && t.acc === acc)

// ---------------------------------------------------------------- format

function extNumber(c: Chord, minorish: boolean): { n: 7 | 9 | 11 | 13; used: Tension[] } {
  const n9 = has(c, 9, 0)
  const n11 = has(c, 11, 0)
  const n13 = has(c, 13, 0)
  const T = (deg: 9 | 11 | 13): Tension => ({ deg, acc: 0 })
  if (minorish) {
    if (n9 && n11 && n13) return { n: 13, used: [T(9), T(11), T(13)] }
    if (n9 && n11) return { n: 11, used: [T(9), T(11)] }
  } else {
    // 13 also covers an altered 9th (13♭9); the altered 9 is listed after it
    if (n13 && c.tensions.some((t) => t.deg === 9)) return { n: 13, used: n9 ? [T(9), T(13)] : [T(13)] }
    if (n9 && n11) return { n: 11, used: [T(9), T(11)] }
  }
  if (n9) return { n: 9, used: [T(9)] }
  return { n: 7, used: [] }
}

const accSym = (acc: number, ascii: boolean): string => (acc === 0 ? '' : accidentalText(acc, ascii))

/** Canonical quality text (everything after the root, without the bass). */
export function formatQuality(c: Chord, ascii = false): string {
  const b = ascii ? 'b' : '♭'
  const sh = ascii ? '#' : '♯'
  const fam = family(c)
  let used: Tension[] = []
  let head: string
  let fifthDone = false
  if (c.third === 'none') {
    head = '5'
  } else if (fam === 'dim' && c.seventh === 'none') {
    head = ascii ? 'dim' : '°'
    fifthDone = true
  } else if (fam === 'dim' && c.seventh === 'dim') {
    head = ascii ? 'dim7' : '°7'
    fifthDone = true
  } else if (fam === 'dim' && c.seventh === 'maj') {
    head = (ascii ? 'dim' : '°') + 'maj7'
    fifthDone = true
  } else if (fam === 'aug') {
    head = '+'
    fifthDone = true
  } else {
    const minor = c.third === 'min'
    head = minor ? 'm' : ''
    if (c.seventh === 'six') {
      head += has(c, 9, 0) ? '6/9' : '6'
      if (has(c, 9, 0)) used = [{ deg: 9, acc: 0 }]
    } else if (c.seventh !== 'none') {
      const e = c.alt ? { n: 7 as const, used: [] } : extNumber(c, minor)
      used = e.used
      head += c.seventh === 'maj' ? (minor ? 'Maj' : 'maj') + e.n : String(e.n)
    }
    if (c.alt) head += 'alt'
  }
  let tail = ''
  if (!fifthDone && c.fifth !== 'p') tail += (c.fifth === 'b' ? b : sh) + '5'
  const rest = c.tensions.filter((t) => !used.some((u) => u.deg === t.deg && u.acc === t.acc))
  const triad = c.seventh === 'none' || c.seventh === 'six'
  for (const t of rest) {
    if (t.acc === 0) tail += 'add' + t.deg
    else if (triad && c.seventh === 'none' && t.deg === 13 && t.acc === -1) tail += b + '6'
    else tail += (triad ? 'add' : '') + accSym(t.acc, ascii) + t.deg
  }
  if (c.third === 'sus4') tail += 'sus4'
  if (c.third === 'sus2') tail += 'sus2'
  if (c.add3) tail += 'add3'
  return head + tail
}

export function formatChord(c: ChordSymbol, ascii = false): string {
  if (c.kind === 'nc') return 'N.C.'
  return noteName(c.root, ascii) + formatQuality(c, ascii) + (c.bass ? '/' + noteName(c.bass, ascii) : '')
}

/** Canonical form of a symbol, or null if it doesn't parse. */
export function canonical(symbol: string): string | null {
  const c = parseChord(symbol)
  return c ? formatChord(c) : null
}

// ---------------------------------------------------------------- tones

export type Slot = 'R' | '3' | '5' | '7'

export interface ChordTone {
  note: Note
  slot: Slot
  /** Degree as written: 1, ♭3, 3, 4, 2, 5, ♭5, ♯5, 6, ♭♭7, ♭7, 7 */
  degree: string
  /** semitones above the root */
  semis: number
}

const IV = (steps: number, semis: number): Interval => ({ steps, semis })

function thirdIv(c: Chord): [Interval, string] | null {
  switch (c.third) {
    case 'maj':
      return [IV(2, 4), '3']
    case 'min':
      return [IV(2, 3), '♭3']
    case 'sus4':
      return [IV(3, 5), '4']
    case 'sus2':
      return [IV(1, 2), '2']
    default:
      return null
  }
}

function fifthIv(c: Chord): [Interval, string] {
  return c.fifth === 'b' ? [IV(4, 6), '♭5'] : c.fifth === '#' ? [IV(4, 8), '♯5'] : [IV(4, 7), '5']
}

function seventhIv(c: Chord): [Interval, string] | null {
  switch (c.seventh) {
    case 'min':
      return [IV(6, 10), '♭7']
    case 'maj':
      return [IV(6, 11), '7']
    case 'dim':
      return [IV(6, 9), '♭♭7']
    case 'six':
      return [IV(5, 9), '6']
    default:
      return null
  }
}

/** Root, 3rd (or sus tone), 5th and 7th (or 6th): the sketch's chordTones(), with slots. */
export function chordTones(c: Chord): ChordTone[] {
  const out: ChordTone[] = [{ note: c.root, slot: 'R', degree: '1', semis: 0 }]
  const push = (x: [Interval, string] | null, slot: Slot): void => {
    if (x) out.push({ note: transpose(c.root, x[0]), slot, degree: x[1], semis: x[0].semis })
  }
  push(thirdIv(c), '3')
  push(fifthIv(c), '5')
  push(seventhIv(c), '7')
  return out
}

const TENSION_IV: Record<number, Interval> = { 9: IV(1, 2), 11: IV(3, 5), 13: IV(5, 9) }

export interface ChordNote {
  note: Note
  degree: string
  semis: number
}

/** Every tone including tensions (and the 3rd of a susadd3), in degree order. */
export function chordNotes(c: Chord): ChordNote[] {
  const out: ChordNote[] = chordTones(c).map(({ note, degree, semis }) => ({ note, degree, semis }))
  if (c.add3) out.splice(1, 0, { note: transpose(c.root, IV(2, 4)), degree: '3', semis: 4 })
  const ts: Tension[] = c.alt
    ? [
        { deg: 9, acc: -1 },
        { deg: 9, acc: 1 },
        { deg: 11, acc: 1 },
        { deg: 13, acc: -1 },
      ]
    : c.tensions
  for (const t of ts) {
    const base = TENSION_IV[t.deg]!
    const iv = IV(base.steps, base.semis + t.acc)
    out.push({ note: transpose(c.root, iv), degree: accSym(t.acc, false) + t.deg, semis: (iv.semis + 12) % 12 })
  }
  return out
}

/** Semitones above the root that a scale must contain for this chord. */
export function requiredPcs(c: Chord, strict: boolean): number[] {
  const req = new Set<number>([0])
  const t = thirdIv(c)
  if (t) req.add(t[0].semis)
  if (c.add3) req.add(4)
  if (c.fifth !== 'p') req.add(fifthIv(c)[0].semis)
  else if (strict && !c.alt && c.third !== 'none') req.add(7)
  const s = seventhIv(c)
  if (s && strict) req.add(s[0].semis)
  for (const n of chordNotes(c).slice(chordTones(c).length + (c.add3 ? 1 : 0))) req.add(n.semis)
  return [...req]
}

export function transposeChord<T extends ChordSymbol>(c: T, iv: Interval): T {
  if (c.kind === 'nc') return c
  const ch = c as Chord
  return { ...ch, root: transpose(ch.root, iv), bass: ch.bass ? transpose(ch.bass, iv) : null } as T
}

export const chordRootPc = (c: Chord): number => pc(c.root)
