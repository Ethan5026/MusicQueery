// The band card (sketch, Backing tracks): mute piano/bass/drums, tempo, key, count-in, style, choruses, and Play.
// It edits the picked track's spec; when that track is the one open on Stand, every change applies at once (the band
// keeps its place, D-12). Keys are shown as written for the chosen instrument; the band always plays concert.
import { BAND_STYLES, PARTS, type Part, STYLE_LABEL } from '@mq/band'
import { mod, note, noteName, pc, toWritten } from '@mq/theory'
import type { BandSpec } from '../../audio/library'
import { useBand } from '../../services'
import { useSettings } from '../../store/settings'
import { Acc } from '../atoms'
import { useSync } from '../stand/live'

const MAJOR = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
const MINOR = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B']

/** The concert tonic a semitone `step` away, spelled as that key usually is. */
export function stepKey(tonic: string, mode: 'major' | 'minor', step: number): string {
  return (mode === 'minor' ? MINOR : MAJOR)[mod(pc(note(tonic)) + step, 12)]!
}

const PART_LABEL: Record<Part, string> = { piano: 'Piano', bass: 'Bass', drums: 'Drums' }

function hint(m: Record<Part, boolean>): string {
  if (m.piano && !m.bass && !m.drums) return 'Piano off: you’re comping'
  if (m.bass && !m.piano && !m.drums) return 'Bass off: you’re the bass'
  if (m.piano && m.bass && !m.drums) return 'Drums only'
  if (m.piano && m.bass && m.drums) return 'Everything off'
  return ''
}

export function BandCard(p: {
  spec: BandSpec
  mode: 'major' | 'minor'
  title: string
  /** the spec is the track open on Stand */
  live: boolean
  onChange: (patch: Partial<BandSpec>) => void
  onPlay: () => void
}) {
  const { mutes, countIn, loading, error, setMute, setCountIn } = useBand()
  const inst = useSettings((s) => s.instrument)
  const sync = useSync()
  const playing = p.live && sync.kind === 'band' && sync.playing
  const { spec } = p
  const written = noteName(toWritten(note(spec.key), inst))
  const drone = spec.style === 'drone'
  return (
    <section className="card band" aria-label="Band" data-testid="band-card">
      <div className="r">
        <span className="tt band-title">{p.title}</span>
      </div>
      <div className="r">
        <span className="lbl">Band</span>
        {PARTS.map((part) => (
          <button key={part} type="button" className="tog" aria-pressed={!mutes[part]} onClick={() => setMute(part, !mutes[part])}>
            {PART_LABEL[part]}
          </button>
        ))}
        <span className="tm band-hint">{hint(mutes)}</span>
      </div>
      <div className="r">
        <span className="lbl">Tempo</span>
        <span className="stepper">
          <button type="button" aria-label="Slower" onClick={() => p.onChange({ bpm: Math.max(40, spec.bpm - 5) })}>
            −
          </button>
          <b className="mono" data-testid="band-bpm">
            {spec.bpm}
          </b>
          <button type="button" aria-label="Faster" onClick={() => p.onChange({ bpm: Math.min(320, spec.bpm + 5) })}>
            +
          </button>
        </span>
        <span className="lbl band-gap">Key</span>
        <span className="stepper">
          <button type="button" aria-label="Key down a semitone" onClick={() => p.onChange({ key: stepKey(spec.key, p.mode, -1) })}>
            ‹
          </button>
          <b data-testid="band-key">
            <Acc text={written + (p.mode === 'minor' ? 'm' : '')} />
          </b>
          <button type="button" aria-label="Key up a semitone" onClick={() => p.onChange({ key: stepKey(spec.key, p.mode, 1) })}>
            ›
          </button>
        </span>
        {inst !== 'concert' && (
          <span className="tm">
            concert <Acc text={spec.key} />
          </span>
        )}
      </div>
      {!drone && (
        <div className="r">
          <span className="lbl">Style</span>
          {BAND_STYLES.map((st) => (
            <button key={st} type="button" className="tog" aria-pressed={spec.style === st} onClick={() => p.onChange({ style: st })}>
              {STYLE_LABEL[st]}
            </button>
          ))}
        </div>
      )}
      <div className="r">
        <button type="button" className="tog" onClick={() => setCountIn((countIn + 1) % 3)} aria-label="Count-in bars">
          {countIn === 0 ? 'No count-in' : `Count-in ${countIn} bar${countIn > 1 ? 's' : ''}`}
        </button>
        <span className="lbl band-gap">Choruses</span>
        <span className="stepper">
          <button type="button" aria-label="Fewer choruses" onClick={() => p.onChange({ choruses: Math.max(1, spec.choruses - 1) })}>
            −
          </button>
          <b className="mono">{spec.choruses}</b>
          <button type="button" aria-label="More choruses" onClick={() => p.onChange({ choruses: Math.min(99, spec.choruses + 1) })}>
            +
          </button>
        </span>
        <button type="button" className="band-play" onClick={p.onPlay} disabled={loading !== null} data-testid="band-play">
          {loading !== null ? `Loading band… ${Math.round(loading * 100)}%` : playing ? 'Open Stand' : 'Play'}
        </button>
      </div>
      {error && <p className="tmsg">{error}</p>}
    </section>
  )
}
