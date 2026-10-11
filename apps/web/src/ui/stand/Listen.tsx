// Listening live on Stand (M7, D-04): the button that turns the mic on for a track with no analysis, the chip that
// shows it is on (tap to stop), the waiting state before the first chord, and the confidence meter.
import { startListening, stopListening, useListen } from '../../listen/listener'

export function ListenButton({ primary = true }: { primary?: boolean }) {
  const { status, error } = useListen()
  return (
    <>
      <button
        type="button"
        className={`btn${primary ? ' primary' : ''}`}
        disabled={status === 'starting'}
        onClick={() => void startListening('listen')}
        data-testid="listen"
      >
        {status === 'starting' ? 'Starting the mic…' : 'Listen with the mic'}
      </button>
      {status === 'error' && <p className="tmsg">Couldn’t listen: {error}</p>}
    </>
  )
}

/** "● Mic" while listening; tap to stop. */
export function ListenChip() {
  const status = useListen((s) => s.status)
  const peak = useListen((s) => s.peak)
  if (status !== 'on') return null
  const level = Math.min(1, Math.max(0, (20 * Math.log10(peak + 1e-6) + 60) / 54))
  return (
    <button type="button" className="micchip" onClick={() => stopListening('user')} aria-label="Stop listening" data-testid="mic-on">
      <i style={{ opacity: 0.35 + 0.65 * level }} />
      Mic
    </button>
  )
}

/** How sure the decoder is about the chord heard now (0..1). */
export function Confidence({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <span className={`conf${pct < 45 ? ' low' : ''}`} title="How sure the mic is" data-testid="confidence">
      <i>
        <b style={{ width: `${pct}%` }} />
      </i>
      {pct}%
    </span>
  )
}

/** Listening, nothing decoded yet. */
export function ListeningWait() {
  const peak = useListen((s) => s.peak)
  const db = 20 * Math.log10(peak + 1e-6)
  const quiet = db < -50
  return (
    <div className="empty wait" data-testid="listening">
      <span className="ch">
        <span className="r">…</span>
      </span>
      <p>{quiet ? 'Listening, but it’s very quiet here. Turn the speaker up or bring the phone closer.' : 'Listening… the first chords show in a few seconds.'}</p>
      <ListenChip />
    </div>
  )
}
