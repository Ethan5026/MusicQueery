// Chart v1 / Timeline v1 schemas (zod). `pnpm --filter @mq/model schema` writes them as JSON Schema
// into packages/model/schema/ for the Python companion.
import { z } from 'zod'

export const MODEL_VERSION = 1

/** Spelled note name with Unicode accidentals: `C`, `E♭`, `F♯`, `B♭♭`. */
export const NoteName = z.string().regex(/^[A-G](?:♭{1,2}|♯{1,2})?$/)
export const Mode = z.enum(['major', 'minor'])
export const KeySig = z.object({ tonic: NoteName, mode: Mode })
export const Meter = z.object({
  num: z.int().min(1).max(32),
  den: z.literal([1, 2, 4, 8, 16]),
})

/** Canonical chord symbol as written by `@mq/theory` (`formatChord`), e.g. `B♭m7`, `C7♯5`, `F/A`, `N.C.`. */
export const ChordText = z.string().min(1).max(40)

// ---------------------------------------------------------------- Chart v1

export const ChordSlot = z.object({
  symbol: ChordText,
  beats: z.number().positive().describe('Duration in beats of the bar meter'),
  alt: ChordText.optional().describe('Alternate chord printed above (iReal parentheses)'),
})

export const Jump = z.enum(['D.C.', 'D.C. al Fine', 'D.C. al Coda', 'D.S.', 'D.S. al Fine', 'D.S. al Coda'])

/** One bar in score order. Repeats, endings and jumps are markers; `expandChart` produces playing order. */
export const Bar = z.object({
  chords: z.array(ChordSlot).min(1),
  meter: Meter.optional().describe('Time signature change starting at this bar'),
  section: z.string().max(20).optional().describe('Rehearsal mark starting here: A, B, Intro, Verse…'),
  repeatStart: z.literal(true).optional(),
  repeatEnd: z.int().min(2).max(16).optional().describe('Repeat sign at the end of this bar; total passes'),
  ending: z.int().min(1).max(9).optional().describe('Volta (1st/2nd ending) starting at this bar'),
  segno: z.literal(true).optional(),
  toCoda: z.literal(true).optional().describe('Jump to the coda after this bar once a D.C./D.S. al Coda was taken'),
  coda: z.literal(true).optional().describe('Coda starts at this bar'),
  jump: Jump.optional().describe('Taken at the end of this bar'),
  fine: z.literal(true).optional(),
  end: z.literal(true).optional().describe('iReal "END": where the final chorus stops'),
  fermata: z.literal(true).optional(),
  simile: z.literal(true).optional().describe('Written as a bar repeat (%)'),
  comment: z.string().max(200).optional(),
})

export const Chart = z.object({
  schema: z.literal('mq.chart/1'),
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  composer: z.string().max(200).optional(),
  style: z.string().max(80).optional(),
  key: KeySig,
  meter: Meter,
  tempo: z.number().positive().max(400).optional().describe('BPM'),
  choruses: z.int().min(1).max(99).optional().describe('Default number of times the form is played'),
  bars: z.array(Bar).min(1),
  source: z
    .object({
      kind: z.enum(['ireal', 'manual', 'demo']),
      playlist: z.string().optional(),
      raw: z.string().optional().describe('Original encoded music string'),
    })
    .optional(),
})

// ---------------------------------------------------------------- Timeline v1

export const TimelineSource = z.enum(['analysed', 'live', 'predicted', 'exact'])

export const TimelineBar = z.object({
  startMs: z.number().min(0),
  number: z.int().min(1).describe('Bar number within the form (1-based)'),
  section: z.string().max(40).optional(),
  pass: z.int().min(1).optional().describe('Chorus / repeat pass, 1-based'),
  chartBar: z.int().min(0).optional().describe('Index into Chart.bars when derived from a chart'),
})

export const TimelineChord = z.object({
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  symbol: ChordText,
  confidence: z.number().min(0).max(1).optional(),
})

export const TimelineKey = z.object({
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  tonic: NoteName,
  mode: Mode,
  confidence: z.number().min(0).max(1).optional(),
})

export const TimelineTempo = z.object({ startMs: z.number().min(0), bpm: z.number().positive() })

export const TimelineEdit = z.object({
  at: z.iso.datetime(),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  symbol: ChordText,
  prev: ChordText.optional(),
})

/** A track's chord fixes, kept apart from its timeline (M7): `PUT /api/edits/:id` takes `{ edits }`. */
export const TimelineEdits = z.array(TimelineEdit).max(500)

export const Timeline = z.object({
  schema: z.literal('mq.timeline/1'),
  id: z.string().min(1).max(120).describe('spotify:track:<id> or chart:<id>'),
  source: TimelineSource,
  durationMs: z.number().min(0),
  createdAt: z.iso.datetime(),
  generator: z.string().max(80).optional(),
  chartId: z.string().max(120).optional(),
  meter: Meter,
  beats: z.array(z.number().min(0)).describe('Beat onsets in ms, ascending'),
  bars: z.array(TimelineBar),
  chords: z.array(TimelineChord),
  keys: z.array(TimelineKey),
  tempo: z.array(TimelineTempo),
  edits: z.array(TimelineEdit).default([]),
})

export type NoteName = z.infer<typeof NoteName>
export type Mode = z.infer<typeof Mode>
export type KeySig = z.infer<typeof KeySig>
export type Meter = z.infer<typeof Meter>
export type ChordSlot = z.infer<typeof ChordSlot>
export type Jump = z.infer<typeof Jump>
export type Bar = z.infer<typeof Bar>
export type Chart = z.infer<typeof Chart>
export type TimelineSource = z.infer<typeof TimelineSource>
export type TimelineBar = z.infer<typeof TimelineBar>
export type TimelineChord = z.infer<typeof TimelineChord>
export type TimelineKey = z.infer<typeof TimelineKey>
export type TimelineTempo = z.infer<typeof TimelineTempo>
export type TimelineEdit = z.infer<typeof TimelineEdit>
export type Timeline = z.infer<typeof Timeline>

export function jsonSchemas(): Record<string, unknown> {
  return {
    'chart.v1.json': z.toJSONSchema(Chart, { target: 'draft-2020-12' }),
    'timeline.v1.json': z.toJSONSchema(Timeline, { target: 'draft-2020-12', io: 'input' }),
  }
}
