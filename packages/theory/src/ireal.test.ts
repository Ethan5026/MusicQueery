import { Chart } from '@mq/model'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { expandChart } from './chart'
import { importPlaylist, keyOf, parsePlaylist, scramble, songToChart, unscramble } from './ireal'

const PREFIX = '1r34LbKcu7'

/** Builds an irealb:// link the way iReal Pro writes one. */
function link(songs: Array<{ title: string; composer?: string; style?: string; key?: string; music: string; bpm?: number; repeats?: number }>, name = 'Test list'): string {
  const enc = songs.map((s) =>
    [s.title, s.composer ?? 'Composer Unknown', '', s.style ?? 'Medium Swing', s.key ?? 'C', '0', PREFIX + scramble(s.music), 'Jazz-Medium Swing', String(s.bpm ?? 0), String(s.repeats ?? 0)].join('='),
  )
  return `<a href="irealb://${encodeURIComponent([...enc, name].join('==='))}">${name}</a>`
}

const chartOf = (music: string, extra: Partial<Parameters<typeof link>[0][number]> = {}): Chart => {
  const pl = parsePlaylist(link([{ title: 'T', music, ...extra }]))
  const { chart, issues } = songToChart(pl.songs[0]!)
  expect(issues).toEqual([])
  return Chart.parse(chart)
}
const bars = (c: Chart): string[] => c.bars.map((b) => b.chords.map((s) => `${s.symbol}:${s.beats}`).join(' '))
const played = (c: Chart): string => expandChart(c).map((b) => b.chords.map((s) => s.symbol).join(',')).join(' | ')

test('unscramble undoes the 50-char block scrambling', () => {
  const s = 'T44*A{C^7XyQ|A-7XyQ|D-7XyQ|G7XyQ}*B[F^7XyQ|E-7 A7 |D-7 G7 |C^7XyQZ' + ' '.repeat(40)
  expect(scramble(s)).not.toBe(s)
  expect(unscramble(scramble(s))).toBe(s)
  const short = 'x'.repeat(51)
  expect(unscramble(short)).toBe(short)
})

test('playlist metadata: name, title, composer, key, tempo, choruses', () => {
  const pl = parsePlaylist(link([{ title: 'Gentle Rain, The', composer: 'Bonfa Luiz', key: 'A-', music: '[T44A-7XyQZ', bpm: 140, repeats: 3 }], 'Jazz 1300'))
  expect(pl.name).toBe('Jazz 1300')
  const s = pl.songs[0]!
  expect([s.title, s.composer, s.style, s.key, s.bpm, s.repeats]).toEqual(['The Gentle Rain', 'Luiz Bonfa', 'Medium Swing', 'A-', 140, 3])
  const { chart } = songToChart(s, pl.name)
  expect(chart.key).toEqual({ tonic: 'A', mode: 'minor' })
  expect(chart.tempo).toBe(140)
  expect(chart.choruses).toBe(3)
  expect(chart.source?.playlist).toBe('Jazz 1300')
  expect(chart.id).toMatch(/^ireal-the-gentle-rain-[0-9a-z]+$/)
})

test.each([
  ['Eb', 'E♭', 'major'], ['F#-', 'F♯', 'minor'], ['Bb-', 'B♭', 'minor'], ['C', 'C', 'major'],
])('key %s', (k, tonic, mode) => {
  expect(keyOf(k)).toEqual({ tonic, mode })
})

test('cells set durations: blanks extend, extra beats go round-robin, overfull bars trim', () => {
  const c = chartOf('[T44C^7XyQ|D-7 G7 |C^7 A-7,D-7 G7 |E-7 A7 D-7 |F^7,G7,|C6 XyQZ')
  expect(bars(c)).toEqual([
    'Cmaj7:4',
    'Dm7:2 G7:2',
    'Cmaj7:1 Am7:1 Dm7:1 G7:1',
    'Em7:1 A7:1 Dm7:2',
    'Fmaj7:2 G7:2',
    'C6:4',
  ])
})

test('small chords stay one beat', () => {
  expect(bars(chartOf('[T44sC7,F7,lBb^7XyQZ'))).toEqual(['C7:1 F7:1 B♭maj7:2'])
})

test('3/4 and a meter change', () => {
  const c = chartOf('[T34C^7XyQ|D-7 G7 |T44C^7XyQZ')
  expect(c.meter).toEqual({ num: 3, den: 4 })
  expect(bars(c)).toEqual(['Cmaj7:3', 'Dm7:1 G7:2', 'Cmaj7:4'])
  expect(c.bars[2]!.meter).toEqual({ num: 4, den: 4 })
  expect(c.bars[0]!.meter).toBeUndefined()
})

test('bar repeats: x (Kcl) and the two-bar r', () => {
  const c = chartOf('[C^7XyQKcl  LZD-7XyQ|G7XyQ|r|XyQ|C^7XyQZ')
  expect(bars(c)).toEqual(['Cmaj7:4', 'Cmaj7:4', 'Dm7:4', 'G7:4', 'Dm7:4', 'G7:4', 'Cmaj7:4'])
  expect(c.bars[1]!.simile).toBe(true)
})

test('repeat with first and second endings', () => {
  const c = chartOf('{*AC^7XyQ|D-7 G7 |N1E-7 A7 }XyQ|N2F^7XyQ]*B[Bb7XyQZ')
  expect(c.bars[0]).toMatchObject({ repeatStart: true, section: 'A' })
  expect(c.bars[2]).toMatchObject({ ending: 1, repeatEnd: 2 })
  expect(c.bars[3]).toMatchObject({ ending: 2 })
  expect(c.bars[4]).toMatchObject({ section: 'B' })
  expect(played(c)).toBe('Cmaj7 | Dm7,G7 | Em7,A7 | Cmaj7 | Dm7,G7 | Fmaj7 | B♭7')
})

test('D.C. al Coda with two coda signs', () => {
  const c = chartOf('*A[T44C^7XyQ|G7XyQQ|C^7XyQ<D.C. al Coda>Z*CQ[C^7 F7 |C^7XyQZ')
  expect(c.bars[1]!.toCoda).toBe(true)
  expect(c.bars[2]!.jump).toBe('D.C. al Coda')
  expect(c.bars[3]).toMatchObject({ coda: true, section: 'C' })
  expect(played(c)).toBe('Cmaj7 | G7 | Cmaj7 | Cmaj7 | G7 | Cmaj7,F7 | Cmaj7')
})

test('N.C., slashes, invisible root, alternate chords, intro/verse marks, fermata, comments', () => {
  const c = chartOf('*i[C7 p p p |n XyQ|*vF7(Db7)XyQ|W/A XyQ|fC^7<Rubato>XyQZ')
  expect(bars(c)).toEqual(['C7:4', 'N.C.:4', 'F7:4', 'F7/A:4', 'Cmaj7:4'])
  expect(c.bars[0]!.section).toBe('Intro')
  expect(c.bars[2]).toMatchObject({ section: 'Verse' })
  expect(c.bars[2]!.chords[0]!.alt).toBe('D♭7')
  expect(c.bars[4]).toMatchObject({ fermata: true, comment: 'Rubato' })
})

test('a meter change holds for the bars after it', () => {
  // Blackbird's intro: 3/4, then 4/4 with four chords a bar
  const c = chartOf('T34G, A-, G/B, |T44G XyQ|C, A7/C#, D, B7/D#, |T24D XyQZ')
  expect(bars(c)).toEqual(['G:1 Am:1 G/B:1', 'G:4', 'C:1 A7/C♯:1 D:1 B7/D♯:1', 'D:2'])
  expect(c.bars.map((b) => b.meter?.num)).toEqual([undefined, 4, undefined, 2])
})

test('unknown chords are reported, not dropped silently', () => {
  const pl = parsePlaylist(link([{ title: 'Bad', music: '[C^7XyQ|C7q XyQZ' }]))
  const { issues } = songToChart(pl.songs[0]!)
  expect(issues.some((i) => i.startsWith('unknown token') || i.startsWith('unparsed chord'))).toBe(true)
})

test('importPlaylist handles several songs', () => {
  const r = importPlaylist(link([{ title: 'One', music: '[C^7XyQZ' }, { title: 'Two', music: '[F7XyQZ' }]))
  expect(r.results.map((x) => x.chart.title)).toEqual(['One', 'Two'])
})

// ---------------------------------------------------------------- corpus (not in git)
// iReal's Essential Playlists (Jazz 1460 — the Jazz 1300 grown — Brazilian, Latin, Blues, Pop, Country),
// saved as irealb:// links under packages/theory/corpus/. See handoffs/M2-theory.md.

const CORPUS = new URL('../corpus/', import.meta.url)
// Quirks in the charts themselves, imported with a fallback (an even split of the bar)
const KNOWN = ['Casa Forte: Casa Forte: 3 chords in a 2-beat bar'] // last bar `ppD-` in 2/2
const lists = existsSync(CORPUS) ? readdirSync(CORPUS).filter((f) => f.endsWith('.txt')) : []

describe.skipIf(lists.length === 0).each(lists)('corpus %s', (file) => {
  let cached: ReturnType<typeof importPlaylist> | null = null
  const corpus = (): ReturnType<typeof importPlaylist> => (cached ??= importPlaylist(readFileSync(new URL(file, CORPUS), 'utf8')))
  test('has the whole playlist', () => {
    const { name, results } = corpus()
    const n = Number(/\d+$/.exec(name ?? '')?.[0] ?? 0)
    expect(results.length).toBeGreaterThanOrEqual(n)
  })
  test('every chord parses', () => {
    const bad = corpus().results.flatMap((r) => r.issues.filter((i) => i.startsWith('unparsed chord')).map((i) => `${r.chart.title}: ${i}`))
    expect(bad).toEqual([])
  })
  test('nothing else is left unread', () => {
    const bad = corpus().results.flatMap((r) => r.issues.map((i) => `${r.chart.title}: ${i}`))
    expect(bad.filter((i) => !KNOWN.includes(i))).toEqual([])
  })
  test('every chart is schema-valid and expands', () => {
    for (const r of corpus().results) {
      Chart.parse(r.chart)
      expect(expandChart(r.chart).length).toBeGreaterThan(0)
    }
  })
})
