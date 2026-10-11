// Settings tab: what changes the chart (instrument, lens, Staff/Keys, theme), Spotify, storage, diagnostics.
import { useEffect, useState } from 'react'
import { clearOffset, listOffsets } from '../../clock/offsets'
import { BUILD, isStandalone } from '../../config'
import { perf } from '../../perf'
import { idbDelete, idbKeys } from '../../store/idb'
import { clock, useApp } from '../../services'
import { useSettings } from '../../store/settings'
import { Seg } from '../atoms'
import { Calibrate } from '../stand/Calibrate'
import { useStandUi, useSync } from '../stand/live'
import { useSubscription } from '../hooks'
import { AuthCard, DebugCard, NowCard, ProbeCard, WakeCard } from './Diagnostics'

export function SettingsTab() {
  const s = useSettings()
  const [diag, setDiag] = useState(false)
  return (
    <div className="page">
      <h1 className="page-h">Settings</h1>
      <section className="card setlist">
        <div className="setrow">
          <span className="lbl">Instrument</span>
          <Seg
            name="set-inst"
            label="Instrument"
            value={s.instrument}
            options={[
              ['concert', 'Concert · piano'],
              ['alto', 'E♭ alto'],
              ['tenor', 'B♭ tenor'],
            ]}
            onChange={(instrument) => s.set({ instrument })}
          />
        </div>
        <div className="setrow">
          <span className="lbl">Play suggestions</span>
          <Seg
            name="set-mode"
            label="Play suggestions"
            value={s.mode}
            options={[
              ['simple', 'Simple'],
              ['integrated', 'Integrated'],
              ['advanced', 'Advanced'],
            ]}
            onChange={(mode) => s.set({ mode })}
          />
          <p className="set-hint">
            Simple: the scale of the key you’re in. Integrated: that scale, plus warnings for chords outside the key
            and key changes. Advanced: a scale for every chord.
          </p>
        </div>
        <div className="setrow">
          <span className="lbl">Scale lens (Advanced)</span>
          <Seg
            name="set-lens"
            label="Scale lens"
            value={s.lens}
            options={[
              ['inside', 'Inside'],
              ['bebop', 'Bebop'],
              ['colour', 'Colour'],
            ]}
            onChange={(lens) => s.set({ lens })}
          />
        </div>
        <div className="setrow">
          <span className="lbl">Show notes as</span>
          <Seg
            name="set-notes"
            label="Show notes as"
            value={s.notes}
            options={[
              ['staff', 'Staff'],
              ['keys', 'Keys'],
            ]}
            onChange={(notes) => s.set({ notes })}
          />
        </div>
        <div className="setrow">
          <span className="lbl">Theme</span>
          <Seg
            name="set-theme"
            label="Theme"
            value={s.theme}
            options={[
              ['stage', 'Stage (dark)'],
              ['paper', 'Paper (light)'],
              ['auto', 'Auto'],
            ]}
            onChange={(theme) => s.set({ theme })}
          />
        </div>
      </section>

      <div className="diag">
        <AuthCard />
        <SpeakersCard />
        <StorageCard />
        <section>
          <h2>Diagnostics</h2>
          <p className="dim">
            Build {BUILD} · {isStandalone() ? 'Home Screen app' : 'browser tab'}
          </p>
          <PerfLine />
          <button onClick={() => setDiag(!diag)}>{diag ? 'Hide' : 'Show'} sync tools and log</button>
        </section>
        {diag && (
          <>
            <NowCard />
            <ProbeCard />
            <WakeCard />
            <DebugCard />
          </>
        )}
      </div>
    </div>
  )
}

const subscribePerf = (cb: () => void) => perf.subscribe(cb)

function PerfLine() {
  useSubscription(subscribePerf)
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 2000)
    return () => clearInterval(id)
  }, [])
  const t = perf.total
  const secs = Math.max(0, Math.round((now - t.sinceMs) / 1000))
  return (
    <p className="dim" data-testid="perf">
      Frames over 50 ms: <b className={t.over50 ? 'warn' : 'ok'}>{t.over50}</b> in {secs} s · longest frame{' '}
      {Math.round(t.maxGapMs)} ms · longest update {t.maxWorkMs.toFixed(1)} ms{' '}
      <button onClick={() => perf.reset()}>Reset</button>
    </p>
  )
}

/** Per-speaker offsets from calibration (the sync badge on Stand opens the same sheet). */
function SpeakersCard() {
  const authed = useApp((s) => s.authed)
  const { calibrating, setCalibrating } = useStandUi()
  useSync() // the current device, as Spotify reports it
  const [, bump] = useState(0)
  const list = listOffsets()
  const current = clock.last?.deviceName
  if (!authed) return null
  return (
    <section>
      <h2>Speakers</h2>
      <p className="hint">
        Each Spotify device can run a little ahead of or behind the chart. Calibrate it once while an analysed track plays
        on it.
      </p>
      {list.length > 0 && (
        <table>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td>{d.name ?? d.id.slice(0, 8)}</td>
                <td className="mono">{d.ms > 0 ? '+' : ''}{d.ms} ms</td>
                <td>
                  <button
                    onClick={() => {
                      clearOffset(d.id)
                      bump((n) => n + 1)
                    }}
                  >
                    Reset
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={() => setCalibrating(true)} disabled={!clock.last?.deviceId}>
        {current ? `Calibrate ${current}` : 'Calibrate (play something first)'}
      </button>
      {calibrating && <Calibrate />}
    </section>
  )
}

function StorageCard() {
  const [ids, setIds] = useState<string[] | null>(null)
  const refresh = () => void idbKeys('timelines').then(setIds)
  useEffect(refresh, [])
  return (
    <section>
      <h2>Saved on this phone</h2>
      <p className="dim">{ids === null ? '…' : `${ids.length} analysed timeline${ids.length === 1 ? '' : 's'}, kept for offline use.`}</p>
      {ids && ids.length > 0 && (
        <button
          onClick={() => {
            void Promise.all(ids.map((id) => idbDelete('timelines', id))).then(refresh)
          }}
        >
          Clear saved timelines
        </button>
      )}
    </section>
  )
}
