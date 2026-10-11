// SP5 (M6): the band on this phone's audio. Plays the 12-bar blues drill at a chosen tempo through the real engine
// and shows what the spike asks: output latency, whether the silent switch mutes it, scheduler timer gaps, voices
// that started late (the only way Web Audio timing can jitter), output stalls, and the audio clock's drift. The
// numbers go to the remote log every 60 s while it plays, and on Send.
import { useEffect, useState } from 'react'
import { type LatencyHint, audioInfo, setLatencyHint } from '../../audio/context'
import { band, statsSummary } from '../../audio/engine'
import { drillSpec } from '../../audio/library'
import { flush, log } from '../../debug/log'
import { ensureBand, openBand, playBand, useBand, useSession } from '../../services'

const TEMPOS = [60, 120, 200, 300]

export function AudioTestCard() {
  const [bpm, setBpm] = useState(120)
  const [hint, setHint] = useState<LatencyHint>('playback')
  const [, setTick] = useState(0)
  const loading = useBand((s) => s.loading)
  const error = useBand((s) => s.error)
  const driver = useSession((s) => s.driver)
  const running = driver === 'audio' && band.playing
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const start = () => {
    void ensureBand()
    void (async () => {
      const spec = drillSpec('blues-12')
      if (!spec || !(await openBand({ ...spec, bpm, choruses: 12 }))) return
      band.resetStats()
      await playBand()
      log('info', 'sp5.start', { bpm, ...audioInfo() })
    })()
  }
  const send = () => {
    log('info', 'sp5.report', { bpm: band.opts.bpm, ...audioInfo(), ...statsSummary(band.stats) })
    void flush()
  }
  const s = statsSummary(band.stats)
  const info = audioInfo()
  return (
    <section>
      <h2>Audio test (SP5)</h2>
      <p className="hint">
        Plays the blues drill on the band for as long as you like. Leave it 10 minutes at 300 BPM with the screen on, then
        Send. Try it with the silent switch on too.
      </p>
      <div className="row">
        {TEMPOS.map((t) => (
          <button key={t} className={t === bpm ? 'primary' : ''} onClick={() => setBpm(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="row">
        {(['playback', 'interactive'] as LatencyHint[]).map((h) => (
          <button
            key={h}
            className={h === hint ? 'primary' : ''}
            disabled={running}
            onClick={() => {
              setHint(h)
              setLatencyHint(h)
            }}
          >
            {h}
          </button>
        ))}
        <span className="dim">latency hint (new context)</span>
      </div>
      <div className="row">
        <button className="primary" onClick={running ? () => band.pause() : start} disabled={loading !== null}>
          {loading !== null ? `Loading ${Math.round(loading * 100)}%` : running ? 'Stop' : 'Start'}
        </button>
        <button onClick={send}>Send</button>
      </div>
      {error && <p className="warn">{error}</p>}
      <p className="dim">
        {`session ${String(info.audioSession)} · ${String(info.state)} · ${String(info.sampleRate ?? '–')} Hz · base ${String(info.baseLatencyMs ?? '–')} ms · output ${String(info.outputLatencyMs ?? '–')} ms`}
      </p>
      <p>
        {`${s.min} min · timer gaps max ${s.gapMaxMs} ms (>50: ${s.gapsOver50}, >100: ${s.gapsOver100}) · lead min ${s.minLeadMs} ms`}
      </p>
      <p className={s.late || s.stalls ? 'warn' : 'ok'}>
        {`late voices ${s.late} (max ${s.maxLateMs} ms) of ${s.voices} · stalls ${s.stalls} · clock drift ${s.driftPpm} ppm`}
      </p>
    </section>
  )
}
