// SP7 (M7): the mic in the standalone app. Listens while Stand follows an analysed track (play one of the truth set
// on the Fire TV, e.g. Let It Be) and shows what the spike asks: whether iOS honoured the raw-mic constraints, the
// level, the worklet's and the decoder's CPU per second of audio, and how often the live chord agrees with the
// PC's analysis (root + third, per beat, as shown, so the display delay counts). Send logs the numbers; the live
// timeline is saved and uploaded when it stops, for scoring on the PC (`pnpm --filter @mq/listen score-live`).
import { flush, log } from '../../debug/log'
import { startListening, stopListening, useListen } from '../../listen/listener'
import { useSession } from '../../services'

export function MicTestCard() {
  const { status, mode, error, now, peak, workletMs, info, agree, saved } = useListen()
  const tl = useSession((s) => s.timeline)
  const running = status === 'on' && mode === 'test'
  const db = 20 * Math.log10(peak + 1e-6)
  const s = info.settings ?? {}
  const pct = agree.n ? Math.round((agree.hit / agree.n) * 100) : null
  const send = () => {
    log('info', 'sp7.report', {
      ...info,
      settings: JSON.stringify(info.settings ?? {}),
      agree: agree.n ? agree.hit / agree.n : null,
      beats: agree.n,
      workletMs: Math.round(workletMs * 10) / 10,
      decoderMs: now ? Math.round(now.cpu * 10) / 10 : null,
      bpm: now ? Math.round(now.bpm) : null,
      track: useSession.getState().id,
    })
    void flush()
  }
  return (
    <section>
      <h2>Mic test (SP7)</h2>
      <p className="hint">
        Play an analysed song on a speaker, start this, and leave the phone where you practise. It compares what the mic
        hears with the PC’s chords as the song plays. Stop saves the live chords for scoring on the PC.
      </p>
      <div className="row">
        <button className="primary" onClick={() => (running ? stopListening('test') : void startListening('test'))} disabled={status === 'starting'}>
          {running ? 'Stop' : status === 'starting' ? 'Starting…' : 'Start'}
        </button>
        <button onClick={send}>Send</button>
        <div className="meter" aria-label="Mic level">
          <div className="meter-peak" style={{ width: `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%` }} />
        </div>
      </div>
      {status === 'error' && <p className="warn">{error}</p>}
      <dl className="kv">
        <dt>Mic</dt>
        <dd>
          {`echo cancel ${String(s.echoCancellation ?? '–')} · noise supp. ${String(s.noiseSuppression ?? '–')} · auto gain ${String(s.autoGainControl ?? '–')}`}
        </dd>
        <dt>Audio</dt>
        <dd>{`${info.sampleRate ?? '–'} Hz · base ${info.baseLatencyMs ?? '–'} ms · session ${info.audioSession ?? '–'}`}</dd>
        <dt>Level</dt>
        <dd>{status === 'on' ? `${db.toFixed(0)} dBFS peak` : '–'}</dd>
        <dt>CPU</dt>
        <dd>{status === 'on' ? `worklet ${workletMs.toFixed(1)} ms/s · decoder ${now ? now.cpu.toFixed(0) : '–'} ms/s` : '–'}</dd>
        <dt>Heard</dt>
        <dd>{now?.symbol ? `${now.symbol} (${Math.round(now.confidence * 100)}%) · ${Math.round(now.bpm)} BPM` : '–'}</dd>
        <dt>vs analysis</dt>
        <dd className={pct === null ? '' : pct >= 55 ? 'ok' : 'warn'}>
          {tl && tl.source !== 'live' ? (pct === null ? 'waiting for chords…' : `${pct}% of ${agree.n} beats agree`) : 'open an analysed track first'}
        </dd>
        <dt>Saved</dt>
        <dd>{saved ? `${saved} listen${saved > 1 ? 's' : ''} saved` : '–'}</dd>
      </dl>
    </section>
  )
}
