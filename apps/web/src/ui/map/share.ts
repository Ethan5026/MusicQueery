// Export (M8): the open song as a plain-text lead sheet, four bars a line like the landscape sheet (sheet.ts):
// rehearsal letters, key changes, "%" for a bar that repeats the last chord. Written pitch for the instrument and
// the chosen chord style, so it reads like Stand. Shared through the iPhone's share sheet (Notes, Messages…).
import type { Timeline } from '@mq/model'
import { INSTRUMENTS, type InstrumentId } from '@mq/theory'
import { type ChordStyle, styleQuality } from '../chordStyle'
import { buildSheet } from '../stand/sheet'
import { homeKey, keyText, tempoAt } from '../stand/view'

export function chartText(tl: Timeline, inst: InstrumentId, title: string, style: ChordStyle): string {
  const { rows } = buildSheet(tl, inst)
  const home = homeKey(tl, inst)
  const bpm = tempoAt(tl, 0)
  const head = [title, home ? keyText(home) : null, bpm ? `${bpm} BPM` : null, INSTRUMENTS[inst].label].filter(Boolean).join(' · ')
  const lines = [head, '']
  let last = ''
  for (const row of rows) {
    const first = row[0]!
    if (first.reh) lines.push(`[${first.reh}]`)
    for (const b of row) if (b.kmark && !b.kmark.home) lines.push(`(${b.kmark.text})`)
    const cells = row.map((b) => {
      const fresh = b.chords.filter((c) => !c.held)
      if (fresh.length === 0) return b.chords.length ? '%' : '–'
      const text = fresh.map((c) => (c.chord.root ? c.chord.root + styleQuality(c.chord.quality, style) + (c.chord.bass ? `/${c.chord.bass}` : '') : c.chord.symbol))
      if (text.length === 1 && text[0] === last) return '%'
      last = text[text.length - 1]!
      return text.join(' ')
    })
    lines.push(`| ${cells.join(' | ')} |${row[row.length - 1]!.end ? '|' : ''}`)
  }
  return lines.join('\n') + '\n'
}

/** Hands the text to the share sheet, or copies it where there is none. Resolves to what happened. */
export async function shareText(title: string, text: string): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share({ title, text })
      return 'shared'
    }
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch (err) {
    return (err as Error)?.name === 'AbortError' ? 'cancelled' : 'failed'
  }
}
