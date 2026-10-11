// Diagnostics from M1 (Spotify login, sync, drift probe, wake lock, remote log), now under Settings.
import { useCallback, useEffect, useRef, useState } from 'react'
import { setOffset, startBiasStore } from '../../clock/offsets'
import { SPOTIFY_CLIENT_ID, redirectUri } from '../../config'
import { flush, log, onLog, recent, remote, session } from '../../debug/log'
import type { DriftPoint, Summary } from '../../probe/analysis'
import { DriftProbe } from '../../probe/DriftProbe'
import { clock, useApp } from '../../services'
import { player } from '../../spotify/api'
import { loadTokens, login, logout } from '../../spotify/auth'
import { wakeLock } from '../../wakelock'
import { fmtMs, fmtTime, useFrame, useSubscription } from '../hooks'

export function AuthCard() {
  const { authed, sp1, refreshAuth } = useApp()
  const tokens = loadTokens()
  const [err, setErr] = useState('')
  return (
    <section>
      <h2>Spotify</h2>
      {!SPOTIFY_CLIENT_ID && <p className="warn">No client ID in this build.</p>}
      {authed ? (
        <>
          <p>
            Logged in. Token refreshes automatically
            {tokens && <> · granted {new Date(tokens.grantedAt).toLocaleDateString()}</>}
          </p>
          <button
            onClick={() => {
              logout()
              refreshAuth()
            }}
          >
            Log out
          </button>
        </>
      ) : (
        <button
          className="primary"
          disabled={!SPOTIFY_CLIENT_ID}
          onClick={() => login().catch((e: unknown) => setErr(String(e)))}
        >
          Log in with Spotify
        </button>
      )}
      {err && <p className="warn">{err}</p>}
      {sp1 && (
        <dl className="kv">
          <dt>SP1 last callback</dt>
          <dd>{new Date(sp1.at).toLocaleString()}</dd>
          <dt>login started in app</dt>
          <dd>{String(sp1.loginStartedStandalone)}</dd>
          <dt>callback in app</dt>
          <dd>{String(sp1.callbackStandalone)}</dd>
          <dt>verifier found</dt>
          <dd>{String(sp1.verifierFound)}</dd>
          <dt>token exchanged</dt>
          <dd>{String(sp1.exchanged)}</dd>
          {sp1.error && (
            <>
              <dt>error</dt>
              <dd className="warn">{sp1.error}</dd>
            </>
          )}
        </dl>
      )}
      <p className="hint">Redirect URI: {redirectUri()}</p>
    </section>
  )
}

const subscribeSamples = (cb: () => void) => clock.onSample(cb)

export function NowCard() {
  const authed = useApp((s) => s.authed)
  useSubscription(subscribeSamples)
  const now = useFrame(authed)
  const s = clock.last
  const [offsetInput, setOffsetInput] = useState('')
  if (!authed) return null
  const rtt = s ? s.t1 - s.t0 : null
  const act = (fn: () => Promise<void>) => () =>
    fn()
      .then(() => clock.pollNow())
      .catch((e: unknown) => log('warn', 'control failed', { err: String(e) }))
  return (
    <section>
      <h2>Now playing</h2>
      {s?.trackId ? (
        <>
          <p className="track">
            {s.trackName} <span className="dim">· {s.artists}</span>
          </p>
          <p className="pos">{fmtTime(clock.positionMs(now))}</p>
          <p className="dim">
            {clock.playing ? 'playing' : 'paused'} on {s.deviceName ?? '?'}
          </p>
        </>
      ) : (
        <p className="dim">{s ? `Nothing playing (HTTP ${s.status})` : 'Waiting for first poll…'}</p>
      )}
      <dl className="kv">
        <dt>RTT</dt>
        <dd>{fmtMs(rtt)}</dd>
        <dt>last poll</dt>
        <dd>{s ? fmtMs(now - s.t1) + ' ago' : '–'}</dd>
        <dt>samples</dt>
        <dd>{clock.samples.length}</dd>
        <dt>device offset</dt>
        <dd>{fmtMs(clock.offsetMs)}</dd>
        <dt>start bias (now / learned)</dt>
        <dd>
          {fmtMs(clock.biasMs)} / {fmtMs(startBiasStore.get(s?.deviceId ?? null))}
        </dd>
        {clock.lastError !== null && (
          <>
            <dt>error</dt>
            <dd className="warn">{String(clock.lastError)}</dd>
          </>
        )}
      </dl>
      <div className="row">
        <button onClick={act(() => player.seek(clock.rawPositionMs() - 10_000))}>−10 s</button>
        <button onClick={act(() => (clock.playing ? player.pause() : player.play()))}>
          {clock.playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={act(() => player.seek(clock.rawPositionMs() + 10_000))}>+10 s</button>
        <button onClick={act(() => player.next())}>Next</button>
      </div>
      {s?.deviceId && (
        <div className="row">
          <input
            inputMode="numeric"
            placeholder="offset ms"
            value={offsetInput}
            onChange={(e) => setOffsetInput(e.target.value)}
          />
          <button
            onClick={() => {
              const v = Number(offsetInput)
              if (Number.isFinite(v) && s.deviceId) setOffset(s.deviceId, v)
            }}
          >
            Set offset for this device
          </button>
        </div>
      )}
    </section>
  )
}

export function ProbeCard() {
  const authed = useApp((s) => s.authed)
  const [bpm, setBpm] = useState('120')
  const [ratio, setRatio] = useState('6')
  const [probe, setProbe] = useState<DriftProbe | null>(null)
  const [status, setStatus] = useState('')
  const subscribe = useCallback((cb: () => void) => (probe ? probe.subscribe(cb) : () => {}), [probe])
  useSubscription(subscribe)
  const now = useFrame(probe?.running ?? false)

  if (!authed) return null

  const start = async () => {
    const p = new DriftProbe(clock, { bpm: Number(bpm), ratio: Number(ratio), toleranceMs: 150 })
    try {
      await wakeLock.enable()
      await p.start()
      setProbe(p)
      setStatus('')
    } catch (e) {
      setStatus(`Could not start: ${String(e)}`)
      log('error', 'probe.start_failed', { err: String(e) })
    }
  }
  const stop = async () => {
    await probe?.stop()
    setStatus('Stopped. Upload the report so it can be analysed.')
  }
  const upload = async () => {
    if (!probe) return
    setStatus('Uploading…')
    try {
      const key = await probe.upload({ wake: { state: wakeLock.state, events: wakeLock.events } })
      setStatus(`Uploaded: ${key}`)
    } catch (e) {
      setStatus(`Upload failed: ${String(e)}`)
    }
  }

  const s = probe?.summary()
  const elapsed = probe ? (probe.running ? now : (probe.onsets.at(-1)?.at ?? now)) - probe.startedAt : 0
  const lastDrift = probe?.onsets.findLast((o) => o.driftMs !== null)?.driftMs
  return (
    <section>
      <h2>Drift probe</h2>
      <p className="hint">
        Play a metronome track on Spotify, ideally from the PC through speakers. Keep this screen open next to the
        speaker and leave it running for 10+ minutes. Then try a few seeks, a pause and resume, and a skip, all from
        the PC.
      </p>
      {!probe?.running ? (
        <div className="row">
          <label>
            BPM <input inputMode="decimal" value={bpm} onChange={(e) => setBpm(e.target.value)} />
          </label>
          <label>
            Sensitivity <input inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} />
          </label>
          <button className="primary" onClick={() => void start()}>
            {probe ? 'Start new run' : 'Start'}
          </button>
        </div>
      ) : (
        <div className="row">
          <button onClick={() => void stop()}>Stop</button>
          <Meter peak={probe.meter.peak} floor={probe.meter.floor} />
        </div>
      )}
      {probe && s && (
        <>
          <dl className="kv">
            <dt>state</dt>
            <dd>
              {!probe.running ? (
                'stopped'
              ) : !s.calibrated ? (
                'calibrating (20 s)…'
              ) : s.outOfLockSinceAt !== null ? (
                <span className="warn">out of lock for {((now - s.outOfLockSinceAt) / 1000).toFixed(1)} s</span>
              ) : (
                <span className="ok">in lock</span>
              )}
            </dd>
            <dt>elapsed</dt>
            <dd>{fmtTime(elapsed).slice(0, -4)}</dd>
            <dt>clicks heard / kept</dt>
            <dd>
              {s.onsets} / {s.onsets - s.rejected}
              {s.unclocked > 0 && ` (${s.unclocked} while clock paused)`}
            </dd>
            <dt>last drift</dt>
            <dd>{fmtMs(lastDrift)}</dd>
            <dt>measured</dt>
            <dd>
              {s.points} clicks over {fmtTime(s.measuredForMs).slice(0, -4)}
              {s.excluded > 0 && ` (${s.excluded} re-lock clicks left out)`}
            </dd>
            <dt>median |drift|</dt>
            <dd className={grade(s.medianAbsMs, 60)}>{fmtMs(s.medianAbsMs, 1)}</dd>
            <dt>p95 |drift|</dt>
            <dd className={grade(s.p95AbsMs, 150)}>{fmtMs(s.p95AbsMs, 1)}</dd>
            <dt>max |drift|</dt>
            <dd>{fmtMs(s.maxAbsMs, 1)}</dd>
            <dt>trend</dt>
            <dd>{s.slopeMsPerMin === null ? '–' : `${s.slopeMsPerMin.toFixed(2)} ms/min`}</dd>
            <dt>tempo check</dt>
            <dd>{s.periodPpm === null ? '–' : `${s.periodPpm.toFixed(0)} ppm vs ${bpm} BPM`}</dd>
            <dt>clock steps (Spotify resync)</dt>
            <dd>{s.steps.length ? s.steps.map((x) => `${x.sizeMs.toFixed(0)} ms`).join(', ') : 'none'}</dd>
            <dt>phase (offset if click 1 is at 0 ms)</dt>
            <dd>{fmtMs(s.referencePhaseMs, 0)}</dd>
          </dl>
          <DriftPlot points={probe.analyzer.points} />
          <Episodes s={s} />
          {!probe.running && (
            <button className="primary" onClick={() => void upload()}>
              Upload report
            </button>
          )}
        </>
      )}
      {status && <p className="dim">{status}</p>}
    </section>
  )
}

function grade(v: number | null, limit: number): string {
  return v === null ? '' : v <= limit ? 'ok' : 'warn'
}

function Meter({ peak, floor }: { peak: number; floor: number }) {
  const db = (x: number) => Math.max(0, Math.min(100, 100 + 20 * Math.log10(Math.max(x, 1e-5)) * 1.0))
  return (
    <div className="meter" title="mic level">
      <div className="meter-floor" style={{ width: `${db(floor)}%` }} />
      <div className="meter-peak" style={{ width: `${db(peak)}%` }} />
    </div>
  )
}

function Episodes({ s }: { s: Summary }) {
  if (s.episodes.length === 0) return null
  return (
    <table>
      <thead>
        <tr>
          <th>event</th>
          <th>re-lock</th>
          <th>≥</th>
        </tr>
      </thead>
      <tbody>
        {s.episodes.map((e, i) => (
          <tr key={i}>
            <td>{e.kind}</td>
            <td className={e.relockMs <= 1500 ? 'ok' : 'warn'}>{fmtMs(e.relockMs)}</td>
            <td className="dim">{fmtMs(e.relockMinMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DriftPlot({ points }: { points: DriftPoint[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = devicePixelRatio || 1
    const w = c.clientWidth
    const h = c.clientHeight
    c.width = w * dpr
    c.height = h * dpr
    const g = c.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    g.clearRect(0, 0, w, h)
    const range = 200
    const y = (d: number) => h / 2 - (d / range) * (h / 2)
    g.strokeStyle = '#3a3f4a'
    for (const d of [-150, -60, 0, 60, 150]) {
      g.beginPath()
      g.moveTo(0, y(d))
      g.lineTo(w, y(d))
      g.stroke()
    }
    if (points.length < 2) return
    const t0 = (points[0] as DriftPoint).at
    const span = Math.max(60_000, (points.at(-1) as DriftPoint).at - t0)
    g.fillStyle = '#d4a93c'
    for (const p of points) {
      g.fillRect(((p.at - t0) / span) * (w - 2), y(Math.max(-range, Math.min(range, p.driftMs))) - 1, 2, 2)
    }
  }, [points, points.length])
  return <canvas ref={ref} className="plot" />
}

const subscribeWake = (cb: () => void) => wakeLock.subscribe(cb)

export function WakeCard() {
  useSubscription(subscribeWake)
  return (
    <section>
      <h2>Wake lock (SP8)</h2>
      <p>
        State: <b className={wakeLock.state === 'on' ? 'ok' : ''}>{wakeLock.state}</b>
      </p>
      <p className="hint">
        Set Auto-Lock to 30 seconds, turn the lock on, and don’t touch the phone for 2 minutes. If the screen stays
        on, it works. The probe turns it on automatically.
      </p>
      <div className="row">
        <button onClick={() => void wakeLock.enable()}>On</button>
        <button onClick={() => void wakeLock.disable()}>Off</button>
      </div>
      {wakeLock.events.length > 0 && <pre className="log">{wakeLock.events.join('\n')}</pre>}
    </section>
  )
}

export function DebugCard() {
  useSubscription(onLog)
  const [open, setOpen] = useState(false)
  const debugOn = localStorage.getItem('mq.debug') === '1'
  return (
    <section>
      <h2>Debug</h2>
      <p className="dim">
        session {session} · remote log sent {remote.sent}, failed {remote.failed}
        {remote.lastError && ` (${remote.lastError})`}
      </p>
      <div className="row">
        <button onClick={() => setOpen(!open)}>{open ? 'Hide log' : 'Show log'}</button>
        <button onClick={() => void flush()}>Flush log</button>
        <button
          onClick={() => {
            localStorage.setItem('mq.debug', debugOn ? '0' : '1')
            location.reload()
          }}
        >
          {debugOn ? 'Disable' : 'Enable'} Eruda
        </button>
        <button onClick={() => location.reload()}>Reload</button>
      </div>
      {open && (
        <pre className="log">
          {recent
            .slice(-60)
            .map((l) => `${new Date(l.t).toLocaleTimeString()} ${l.l[0]} ${l.m} ${l.d ? JSON.stringify(l.d) : ''}`)
            .join('\n')}
        </pre>
      )}
    </section>
  )
}
