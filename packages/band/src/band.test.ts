import { Timeline } from '@mq/model'
import { DEMO_CHART, chartTimeline, chord, mod, parseChord, pc } from '@mq/theory'
import { describe, expect, it } from 'vitest'
import {
  Arranger,
  BAND_STYLES,
  type BandEvent,
  type BandStyle,
  DRILLS,
  type NoteEvent,
  TUNES,
  chordAt,
  cycleOfKeys,
  formFromChart,
  lead,
  styleFor,
  swingAt,
  voice,
} from './index'

const notes = (evs: BandEvent[], part: 'piano' | 'bass') => evs.filter((e): e is NoteEvent => e.part === part)

describe('form', () => {
  it('lines up with the exact timeline, bar for bar', () => {
    const f = formFromChart(DEMO_CHART)
    const tl = chartTimeline(DEMO_CHART, { bpm: 120 })
    expect(f.bars.length).toBe(tl.bars.length)
    expect(f.totalBeats).toBe(tl.beats.length)
    f.bars.forEach((b, i) => expect(b.startBeat * 500).toBeCloseTo(tl.bars[i]!.startMs, 6))
  })
  it('repeats the form for choruses', () => {
    const blues = TUNES.find((t) => t.id === 'blues-in-f')!
    expect(formFromChart(blues, 3).bars.length).toBe(36)
    expect(formFromChart(blues, 3).bars[12]!.pass).toBe(2)
  })
  it('finds the current and next chord across a barline', () => {
    const f = formFromChart(TUNES.find((t) => t.id === 'blues-in-f')!, 1)
    expect(chordAt(f, 3, 2.5).cur?.symbol).toBe('F7')
    expect(chordAt(f, 3, 2.5).next?.symbol).toBe('B♭7')
  })
})

describe('styles', () => {
  it.each([
    ['Medium Swing', 4, 'swing'],
    ['Up Tempo Swing', 4, 'swing'],
    ['Slow Swing', 4, 'swing'],
    ['Ballad', 4, 'ballad'],
    ['Pop Ballad', 4, 'ballad'],
    ['Bossa Nova', 4, 'bossa'],
    ['Samba', 4, 'bossa'],
    ['Latin', 4, 'bossa'],
    ['Waltz', 3, 'waltz'],
    ['Medium Swing', 3, 'waltz'],
    ['Rock Pop', 4, 'pop'],
    ['Even 8ths', 4, 'pop'],
    ['Country', 4, 'pop'],
    ['Funk', 4, 'funk'],
    ['Soul', 4, 'funk'],
    ['Drone', 4, 'drone'],
    [undefined, 4, 'swing'],
  ] as const)('%s in %i → %s', (s, m, want) => expect(styleFor(s, m)).toBe(want))

  it('swings less as the tempo rises, and not at all in straight styles', () => {
    expect(swingAt('swing', 100)).toBeCloseTo(2 / 3)
    expect(swingAt('swing', 300)).toBeCloseTo(0.55)
    expect(swingAt('swing', 190)).toBeGreaterThan(0.55)
    expect(swingAt('swing', 190)).toBeLessThan(2 / 3)
    expect(swingAt('pop', 100)).toBe(0.5)
    expect(swingAt('bossa', 100)).toBe(0.5)
  })
})

describe('voicings', () => {
  const pcsOf = (v: number[]) => new Set(v.map((m) => mod(m, 12)))
  it('keeps the 3rd and 7th of seventh chords and leaves the root to the bass', () => {
    for (const [sym, third, seventh] of [
      ['G7', 'B', 'F'],
      ['Cmaj7', 'E', 'B'],
      ['Dm7', 'F', 'C'],
      ['B♭7♯9', 'D', 'A♭'],
    ] as const) {
      const v = pcsOf(voice(chord(sym), null, 'swing'))
      expect(v.has(pc({ letter: 'CDEFGAB'.indexOf(third[0]!), acc: third.includes('♭') ? -1 : 0 }))).toBe(true)
      expect(v.has(pc({ letter: 'CDEFGAB'.indexOf(seventh[0]!), acc: seventh.includes('♭') ? -1 : 0 }))).toBe(true)
    }
  })
  it('plays triads as close voicings with the whole triad', () => {
    const v = pcsOf(voice(chord('F'), null, 'pop'))
    expect([...v].sort((a, b) => a - b)).toEqual([0, 5, 9])
  })
  it('moves by small steps through a ii–V–I', () => {
    let prev: number[] | null = null
    let moved = 0
    for (const s of ['Dm7', 'G7', 'Cmaj7', 'Fmaj7', 'Bm7♭5', 'E7', 'Am7']) {
      const v = voice(chord(s), prev, 'swing')
      if (prev) moved += v.reduce((a, n, i) => a + Math.abs(n - prev![i]!), 0) / v.length
      prev = v
      expect(v[0]).toBeGreaterThanOrEqual(46)
      expect(v[v.length - 1]).toBeLessThanOrEqual(79)
    }
    expect(moved / 6).toBeLessThan(2.5)
  })
})

describe('arranger', () => {
  const all = [...TUNES, ...DRILLS.map((d) => d.build(d.key))]
  it('plays every bar of every tune and drill in every style, in range and inside its bar', () => {
    const bad: string[] = []
    for (const chart of all) {
      const form = formFromChart(chart, 1)
      for (const style of [...BAND_STYLES, 'drone'] as BandStyle[]) {
        const a = new Arranger(form, { style, bpm: 140 })
        form.bars.forEach((bar, i) => {
          const where = `${chart.id} ${style} bar ${i}`
          const evs = a.bar(i)
          for (const e of evs) {
            if (e.beat < bar.startBeat - 1e-9 || e.beat >= bar.startBeat + bar.beats) bad.push(`${where}: beat ${e.beat}`)
            if (!(e.vel > 0 && e.vel <= 1)) bad.push(`${where}: vel ${e.vel}`)
            if (e.part === 'piano' && (e.midi < 46 || e.midi > 80)) bad.push(`${where}: piano ${e.midi}`)
            if (e.part === 'bass' && (e.midi < 24 || e.midi > 67)) bad.push(`${where}: bass ${e.midi}`)
          }
          if (style !== 'drone' && bar.chords.some((c) => c.chord)) {
            if (!notes(evs, 'piano').length) bad.push(`${where}: no piano`)
            if (!notes(evs, 'bass').length) bad.push(`${where}: no bass`)
          }
        })
      }
    }
    expect(bad.slice(0, 10)).toEqual([])
  }, 30_000)

  it('walks: the bass lands on each chord’s root (or slash bass) as it starts', () => {
    const chart = TUNES.find((t) => t.id === 'autumn-leaves')!
    const form = formFromChart(chart, 1)
    const a = new Arranger(form, { style: 'swing', bpm: 140 })
    form.bars.forEach((bar, i) => {
      const bass = notes(a.bar(i), 'bass')
      expect(bass.length).toBe(4)
      for (const c of bar.chords) {
        const n = bass.find((e) => Math.abs(e.beat - (bar.startBeat + c.beat)) < 1e-9)!
        expect(mod(n.midi, 12)).toBe(pc(c.chord!.bass ?? c.chord!.root))
      }
    })
  })

  it('is deterministic per bar: a bar sounds the same after a seek', () => {
    const form = formFromChart(TUNES.find((t) => t.id === 'rhythm-changes')!, 1)
    const a = new Arranger(form, { style: 'swing', bpm: 200, seed: 7 })
    const b = new Arranger(form, { style: 'swing', bpm: 200, seed: 7 })
    for (let i = 0; i < 8; i++) a.bar(i)
    const inOrder = a.bar(8).filter((e) => e.part === 'drums')
    const afterSeek = b.bar(8).filter((e) => e.part === 'drums')
    expect(afterSeek).toEqual(inOrder)
    expect(new Arranger(form, { style: 'swing', bpm: 200, seed: 7 }).bar(3)).toEqual(new Arranger(form, { style: 'swing', bpm: 200, seed: 7 }).bar(3))
  })

  it('swings the ride’s skip note and keeps pop straight', () => {
    const form = formFromChart(TUNES.find((t) => t.id === 'blues-in-f')!, 1)
    const ride = new Arranger(form, { style: 'swing', bpm: 120 }).bar(1).filter((e) => e.part === 'drums' && e.piece === 'ride')
    expect(ride.map((e) => +(e.beat - 4).toFixed(3))).toEqual([0, 1, 1.667, 2, 3, 3.667])
    const hats = new Arranger(form, { style: 'pop', bpm: 120 }).bar(1).filter((e) => e.part === 'drums' && e.piece === 'hhclosed')
    expect(hats.map((e) => e.beat - 4)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
  })

  it('counts in on every beat before the form', () => {
    const form = formFromChart(TUNES.find((t) => t.id === 'jazz-waltz')!, 1)
    const c = new Arranger(form, { style: 'waltz', bpm: 150 }).countIn(2)
    expect(c.map((e) => e.beat)).toEqual([-6, -5, -4, -3, -2, -1])
  })
})

describe('drills', () => {
  it('cycles up a fourth from any key, spelled per key', () => {
    expect(cycleOfKeys('C', 'major')).toEqual(['C', 'F', 'B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'B', 'E', 'A', 'D', 'G'])
    expect(cycleOfKeys('A', 'minor')[0]).toBe('A')
    expect(cycleOfKeys('A', 'minor')[8]).toBe('C♯')
  })
  it.each(DRILLS.map((d) => [d.id, d] as const))('%s builds a valid chart and an exact timeline', (_id, d) => {
    const chart = d.build(d.key)
    for (const b of chart.bars) for (const s of b.chords) expect(parseChord(s.symbol), s.symbol).not.toBeNull()
    const tl = Timeline.parse(chartTimeline(chart, { bpm: d.tempo }))
    expect(tl.source).toBe('exact')
    expect(tl.chords.length).toBeGreaterThan(0)
  })
  it('the all-keys drills visit twelve keys, one section each', () => {
    const d = DRILLS.find((x) => x.id === 'major-251')!
    const chart = d.build('E♭')
    const sections = chart.bars.filter((b) => b.section).map((b) => b.section)
    expect(sections).toEqual(cycleOfKeys('E♭', 'major'))
    expect(chart.bars[0]!.chords[0]!.symbol).toBe('Fm7')
    expect(chart.key.tonic).toBe('E♭')
  })
})

describe('lead()', () => {
  it('splits bars and chords and reads sections', () => {
    const bars = lead('[A] Bbmaj7 G7 | Cm7 F7 | [B] D7')
    expect(bars.map((b) => b.chords.map((c) => `${c.symbol}:${c.beats}`))).toEqual([['B♭maj7:2', 'G7:2'], ['Cm7:2', 'F7:2'], ['D7:4']])
    expect(bars[0]!.section).toBe('A')
    expect(bars[2]!.section).toBe('B')
  })
  it('refuses a chord it can’t read', () => expect(() => lead('Hm7')).toThrow())
})
