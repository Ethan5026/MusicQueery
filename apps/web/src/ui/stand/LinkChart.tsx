// Link a chart (M7): pick an imported iReal chart (or a built-in tune) for the track; the phone lines it up with the
// recording (Jump Alignment) and, if it fits, shows its chord names and rehearsal marks from then on. A chart that
// only fits by rearranging its bars (another song's) is refused with the numbers that refused it.
import type { AlignResult } from '@mq/listen'
import { useEffect, useMemo, useState } from 'react'
import { type ChartEntry, TUNES, chartIndex } from '../../audio/library'
import { linkChart, useSession } from '../../services'
import { useStandUi } from './live'

/** "Let It Be - Remastered 2009" → "let it be" */
const cleanTitle = (t: string): string =>
  t
    .replace(/\s+-\s+.*$/, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .trim()
    .toLowerCase()

interface Option {
  ref: string
  title: string
  sub: string
}

export function LinkChart({ title }: { title: string }) {
  const close = () => useStandUi.getState().setLinking(false)
  const linked = useSession((s) => s.linked)
  const [index, setIndex] = useState<ChartEntry[] | null>(null)
  const [q, setQ] = useState(() => cleanTitle(title))
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ title: string; r: AlignResult | null } | null>(null)
  useEffect(() => void chartIndex().then(setIndex), [])
  const options = useMemo<Option[]>(() => {
    const all: Option[] = [
      ...(index ?? []).map((e) => ({ ref: e.id, title: e.title, sub: [e.composer, e.playlist].filter(Boolean).join(' · ') })),
      ...TUNES.map((t) => ({ ref: `tune:${t.id}`, title: t.title, sub: 'Built-in tune' })),
    ]
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return words.length ? all.filter((o) => words.every((w) => o.title.toLowerCase().includes(w))).slice(0, 8) : []
  }, [index, q])

  const pick = async (o: Option) => {
    setBusy(o.ref)
    const r = await linkChart({ ref: o.ref, title: o.title, at: new Date().toISOString() })
    setBusy(null)
    setResult({ title: o.title, r })
    if (r?.timeline) setTimeout(close, 900)
  }

  return (
    <div className="cal-back" role="dialog" aria-label="Link a chart" onClick={(e) => e.target === e.currentTarget && close()}>
      <section className="card cal">
        <div className="cal-h">
          <span className="cal-dev">Link a chart</span>
          <button type="button" className="btn" onClick={close}>
            Close
          </button>
        </div>
        <p className="cal-p">
          The chart’s chord names replace the heard ones wherever it lines up with the recording. Charts come from your iReal
          Pro imports (Tracks → Generated).
        </p>
        {linked && (
          <div className="cal-res">
            <span>Linked: {linked.link.title}</span>
            <button type="button" className="btn" onClick={() => void linkChart(null).then(close)}>
              Unlink
            </button>
          </div>
        )}
        <input className="tsearch" type="search" aria-label="Search charts" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="tlist" data-testid="link-options">
          {options.map((o) => (
            <button type="button" key={o.ref} className="trow" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }} disabled={busy !== null} onClick={() => void pick(o)}>
              <span style={{ minWidth: 0 }}>
                <span className="tt">{o.title}</span>
                <span className="tm">{o.sub}</span>
              </span>
              <span className="tm">{busy === o.ref ? 'Lining up…' : ''}</span>
            </button>
          ))}
          {index !== null && options.length === 0 && <p className="tnote">No chart with that title. Import a playlist in Tracks → Generated.</p>}
        </div>
        {result && (
          <p className={result.r?.timeline ? 'cal-p' : 'tmsg'} data-testid="link-result">
            {!result.r
              ? 'That chart is gone.'
              : result.r.timeline
                ? `Linked ${result.title}: it covers ${Math.round(result.r.matched * 100)}% of the song and agrees with what was heard on ${Math.round(result.r.agreement * 100)}% of beats.`
                : `${result.title} doesn’t fit this recording (roots agree on ${Math.round(result.r.agreement * 100)}% of beats, ${result.r.jumpRate.toFixed(2)} jumps a bar). Not linked.`}
          </p>
        )}
      </section>
    </div>
  )
}
