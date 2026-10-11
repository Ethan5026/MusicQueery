// Calibration (02-dev-plan: per-device offset, tap-along). Opened from the sync badge while Spotify plays an
// analysed track: tap on every beat you hear, and the median gap between your taps and the recording's beats
// becomes this speaker's offset. Earlier / Later nudge it by 10 ms by eye; the chart moves at once.
import { useMemo, useState } from 'react'
import { MIN_TAPS, fitTaps } from '../../clock/calibrate'
import { clearOffset, offsetFor, setOffset } from '../../clock/offsets'
import { log } from '../../debug/log'
import { clock, useSession } from '../../services'
import { useStandUi, useSync } from './live'

const signed = (ms: number): string => `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(Math.round(ms))} ms`

export function Calibrate() {
  const close = () => useStandUi.getState().setCalibrating(false)
  const { timeline, driver } = useSession()
  useSync() // re-render on play/pause
  const device = clock.last?.deviceId ?? null
  const name = clock.last?.deviceName ?? 'this speaker'
  const [offset, setOff] = useState(() => offsetFor(device))
  const [taps, setTaps] = useState<number[]>([])
  const beats = timeline?.beats
  const fit = useMemo(() => fitTaps(beats ?? [], taps), [beats, taps])
  const ready = driver === 'spotify' && clock.playing && (beats?.length ?? 0) > 8 && device !== null

  const save = (ms: number, how: string) => {
    if (!device) return
    if (ms === 0) clearOffset(device)
    else setOffset(device, ms, name)
    setOff(Math.round(ms))
    setTaps([])
    log('info', 'calibrate.set', { device: name, ms: Math.round(ms), how, ...(how === 'taps' ? { taps: fit.used, spread: fit.spreadMs } : {}) })
  }

  return (
    <div className="cal-back" role="presentation" onClick={close}>
      <section className="cal card" role="dialog" aria-modal="true" aria-label="Calibrate" onClick={(e) => e.stopPropagation()}>
        <div className="cal-h">
          <span className="lbl">Calibrate</span>
          <b className="cal-dev">{name}</b>
          <button type="button" className="btn" onClick={close}>
            Done
          </button>
        </div>
        {ready ? (
          <>
            <p className="cal-p">
              Tap the pad on every beat you hear, for about ten seconds. Your taps are compared with this recording’s
              beats, and the chart shifts to match this speaker.
            </p>
            <button
              type="button"
              className="cal-pad"
              data-testid="tap-pad"
              onPointerDown={(e) => {
                // event.timeStamp is on the performance.now() clock; fall back if a browser disagrees
                const at = Math.abs(e.timeStamp - performance.now()) < 1000 ? e.timeStamp : performance.now()
                setTaps((t) => [...t.slice(-40), clock.positionMs(at)])
              }}
            >
              <span>Tap on the beat</span>
              <small className="mono">
                {fit.used < MIN_TAPS ? `${fit.used} / ${MIN_TAPS}` : `${fit.used} taps · steady to ±${fit.spreadMs} ms`}
              </small>
            </button>
            {fit.correctionMs !== null && (
              <div className="cal-res">
                <span>
                  {Math.abs(fit.correctionMs) < 15
                    ? 'The chart is on the beat.'
                    : `The chart runs ${Math.abs(fit.correctionMs)} ms ${fit.correctionMs < 0 ? 'ahead of' : 'behind'} the speaker.`}
                </span>
                <button type="button" className="btn primary" onClick={() => save(offset + fit.correctionMs!, 'taps')}>
                  Apply {signed(fit.correctionMs)}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="cal-p">
            Play an analysed track on the speaker you want to calibrate, then tap along here. Fine-tuning below works any
            time.
          </p>
        )}
        <div className="cal-off">
          <span>
            Offset for this speaker <b className="mono">{signed(offset)}</b>
          </span>
          <div className="cal-nudge">
            <button type="button" className="btn" disabled={!device} onClick={() => save(offset + 10, 'nudge')}>
              Earlier
            </button>
            <button type="button" className="btn" disabled={!device} onClick={() => save(offset - 10, 'nudge')}>
              Later
            </button>
            <button type="button" className="btn" disabled={!device || offset === 0} onClick={() => save(0, 'reset')}>
              Reset
            </button>
          </div>
          <p className="cal-hint">Chords change after you hear them? Tap Earlier. Before? Tap Later.</p>
        </div>
      </section>
    </div>
  )
}
