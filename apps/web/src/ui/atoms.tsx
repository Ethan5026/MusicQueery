// Shared atoms from the sketch: accidentals in Noto Music, Real Book chord symbols, source and sync badges.
import type { TimelineSource } from '@mq/model'
import type { MomentChord } from '@mq/theory'
import type { CSSProperties } from 'react'
import type { SyncState } from '../clock/sync'
import { useSettings } from '../store/settings'
import { styleQuality } from './chordStyle'

const dbl = (s: string): string => s.replace(/♯♯/g, '𝄪').replace(/♭♭/g, '𝄫')

/** Text with every accidental set small in the music font. */
export function Acc({ text }: { text: string }) {
  const parts = dbl(text).split(/([♭♯♮𝄪𝄫]+)/u)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} className="acc">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  )
}

/** A chord lettered like a Real Book chart: root, then the quality raised and smaller. */
export function ChordSym({ chord, className, style }: { chord: MomentChord | null; className?: string; style?: CSSProperties }) {
  const chordStyle = useSettings((s) => s.chords)
  const cls = `ch${className ? ' ' + className : ''}`
  if (!chord || !chord.root)
    return (
      <span className={cls} style={style}>
        <span className="r">{chord?.symbol ?? 'N.C.'}</span>
      </span>
    )
  return (
    <span className={cls} style={style}>
      <span className="r">
        <Acc text={chord.root} />
      </span>
      <span className="q">
        <Acc text={styleQuality(chord.quality, chordStyle) + (chord.bass ? `/${chord.bass}` : '')} />
      </span>
    </span>
  )
}

const SOURCE: Record<TimelineSource, [string, string]> = {
  analysed: ['exact', 'Analysed'],
  exact: ['exact', 'Exact'],
  live: ['live', 'Listening live'],
  predicted: ['pred', 'Predicted'],
}

/** Where the chords came from (D-04). A saved listen that isn't being added to right now says "Heard live". */
export function SourceBadge({ source, listening = true }: { source: TimelineSource; listening?: boolean }) {
  const [cls, text] = SOURCE[source]
  return <span className={`src ${cls}`}>{source === 'live' && !listening ? 'Heard live' : text}</span>
}

export type { SyncState }

const SYNC_LABEL = (st: SyncState): [string, string] => {
  switch (st.kind) {
    case 'locked':
      return ['ok', `±${Math.round(st.ms)} ms`]
    case 'resync':
      return ['warn', 'Re-syncing']
    case 'paused':
      return ['idle', 'Paused']
    case 'idle':
      return ['idle', 'Not playing']
    case 'offline':
      return ['alert', 'Not connected']
    case 'manual':
      return ['idle', st.playing ? 'Manual' : 'Paused']
    case 'band':
      return st.countIn > 0 ? ['warn', `Count-in ${st.countIn}`] : ['ok', st.playing ? 'Band' : 'Paused']
  }
}

/** How closely the dashboard follows the playhead (sketch: the four sync states). Tappable when `onClick` is set. */
export function SyncBadge({ state, onClick, title }: { state: SyncState; onClick?: () => void; title?: string }) {
  const [cls, text] = SYNC_LABEL(state)
  const body = (
    <>
      <i />
      {text}
    </>
  )
  return onClick ? (
    <button type="button" data-testid="sync" className={`sync ${cls} tap`} onClick={onClick} title={title} aria-label={title ? `${text}. ${title}` : text}>
      {body}
    </button>
  ) : (
    <span className={`sync ${cls}`} data-testid="sync">
      {body}
    </span>
  )
}

/** Tab icons, drawn as in the sketch. */
export const TAB_ICONS: Record<string, string> = {
  stand: 'M5 4h14v9H5zM8 7h8M8 10h5M12 13v7M8 20h8',
  tracks: 'M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4',
  map: 'M3 7h18M3 12h18M3 17h18M9 4v16M15 4v16',
  settings: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
}

export function TabIcon({ tab }: { tab: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {tab === 'coach' ? (
        <>
          <path d="M9 18V6l10-2v12" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="16.5" cy="16" r="2.5" />
        </>
      ) : (
        <>
          <path d={TAB_ICONS[tab]} />
          {tab === 'settings' && <circle cx="12" cy="12" r="3" />}
        </>
      )}
    </svg>
  )
}

/** A segmented control (the sketch's `.seg` / `.mini-seg`). */
export function Seg<T extends string>({
  name,
  value,
  options,
  onChange,
  mini,
  label,
}: {
  name: string
  value: T
  options: Array<[T, string]>
  onChange: (v: T) => void
  mini?: boolean
  label: string
}) {
  return (
    <div className={mini ? 'mini-seg' : 'seg'} role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <span key={v} className="seg-opt">
          <input type="radio" name={name} id={`${name}-${v}`} value={v} checked={value === v} onChange={() => onChange(v)} />
          <label htmlFor={`${name}-${v}`}>
            <Acc text={text} />
          </label>
        </span>
      ))}
    </div>
  )
}
