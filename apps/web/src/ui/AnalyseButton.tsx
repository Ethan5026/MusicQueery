// "Analyse on the PC": queue a Spotify track for the companion (timeline/queue.ts) and show where it stands.
import { useEffect, useState } from 'react'
import { useApp } from '../services'
import { type QueueStatus, queueStatus, requestAnalysis } from '../timeline/queue'

const when = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

export function AnalyseButton({ id, title, artist, onDone }: { id: string; title?: string; artist?: string; onDone?: () => void }) {
  const authed = useApp((s) => s.authed)
  const [st, setSt] = useState<QueueStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void queueStatus(id).then((s) => live && setSt(s))
    return () => {
      live = false
    }
  }, [id])
  useEffect(() => {
    if (st?.state === 'done') onDone?.()
  }, [st, onDone])

  const ask = async () => {
    setBusy(true)
    setSt(await requestAnalysis(id, { ...(title ? { title } : {}), ...(artist ? { artist } : {}) }))
    setBusy(false)
  }

  const note =
    st?.state === 'queued'
      ? `Queued${st.requestedAt ? ` ${when(st.requestedAt)}` : ''}. The PC analyses it once Spotify has been idle for a while, then the chords appear here.`
      : st?.state === 'working'
        ? 'The PC is analysing it now (about as long as the song).'
        : st?.state === 'failed'
          ? `The last try failed: ${st.error}`
          : st?.state === 'unknown'
            ? st.message
            : 'The PC analyses queued tracks while nothing is playing, so it never takes over your speaker.'
  const canAsk = authed && (st === null || st.state === 'none' || st.state === 'failed' || st.state === 'unknown')

  return (
    <div className="analyse" data-testid="analyse">
      {canAsk && (
        <button type="button" className="btn primary" disabled={busy} onClick={() => void ask()}>
          {st?.state === 'failed' ? 'Try again on the PC' : 'Analyse on the PC'}
        </button>
      )}
      <p className="tnote">{note}</p>
    </div>
  )
}
