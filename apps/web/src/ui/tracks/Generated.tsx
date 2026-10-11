// Tracks → Generated (D-12): the band plays a chart. Built-in tunes, then charts imported from iReal Pro playlists
// (one tap for iReal's official playlists through the Worker, or a pasted irealb:// link, or a file). Search covers
// titles, composers, styles and keys. Chords are exact from bar one, so Stand has full look-ahead.
import { STYLE_LABEL, styleFor } from '@mq/band'
import { useEffect, useMemo, useState } from 'react'
import { type ChartEntry, TUNES, chartIndex, defaultSpec, importIreal, importedChart, removePlaylist } from '../../audio/library'
import { API_URL } from '../../config'
import { useBackingPick } from './backing'
import { TrackRow } from './Songs'

const SHOW = 80

interface Row {
  kind: 'tune' | 'ireal'
  id: string
  title: string
  sub: string
  key: string
  mode: 'major' | 'minor'
  search: string
  playlist?: string
}

const tuneRows: Row[] = TUNES.map((t) => {
  const style = styleFor(t.style, t.meter.num)
  return {
    kind: 'tune',
    id: t.id,
    title: t.title,
    sub: `${t.style ?? STYLE_LABEL[style]} · ${t.tempo ?? ''} · ${t.bars.length} bars`,
    key: t.key.tonic,
    mode: t.key.mode,
    search: `${t.title} ${t.composer ?? ''} ${t.style ?? ''} ${t.key.tonic}`.toLowerCase(),
  }
})

const entryRow = (e: ChartEntry): Row => ({
  kind: 'ireal',
  id: e.id,
  title: e.title,
  sub: [e.composer, e.style, `${e.bars} bars`].filter(Boolean).join(' · '),
  key: e.key,
  mode: e.mode,
  search: `${e.title} ${e.composer ?? ''} ${e.style ?? ''} ${e.key} ${e.playlist}`.toLowerCase(),
  playlist: e.playlist,
})

/** Search text with accidentals typed either way: "Bb" finds B♭. */
const norm = (s: string): string => s.toLowerCase().replace(/b(?=\b|m)/g, '♭').replace(/#/g, '♯')

export function GeneratedPanel() {
  const [index, setIndex] = useState<ChartEntry[] | null>(null)
  const [q, setQ] = useState('')
  const [importing, setImporting] = useState(false)
  const { pick, setPick, card, openRef } = useBackingPick(['tune', 'ireal'])
  const reload = () => void chartIndex().then(setIndex)
  useEffect(reload, [])

  const rows = useMemo(() => [...tuneRows, ...(index ?? []).map(entryRow)], [index])
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return rows
    return rows.filter((r) => words.every((w) => r.search.includes(w) || r.search.includes(norm(w))))
  }, [rows, q])
  const playlists = useMemo(() => [...new Set((index ?? []).map((e) => e.playlist))], [index])

  const choose = async (r: Row) => {
    const chart = r.kind === 'tune' ? TUNES.find((t) => t.id === r.id) : await importedChart(r.id)
    if (!chart) return
    setPick({ spec: defaultSpec(r.kind, chart), mode: chart.key.mode, title: chart.title })
  }

  return (
    <>
      <input
        className="tsearch"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search tunes, composers, styles, keys"
        aria-label="Search tunes"
        autoComplete="off"
        spellCheck={false}
      />
      <div className="tsec-h">
        <span className="tnote">Played by the app. Chords are exact, so Stand has full look-ahead.</span>
        <button type="button" className="tlink" onClick={() => setImporting(!importing)}>
          {importing ? 'Close' : 'Import iReal Pro'}
        </button>
      </div>
      {importing && (
        <IrealImport
          playlists={playlists}
          onDone={() => {
            reload()
          }}
        />
      )}
      <div className="tlist" role="list">
        {shown.slice(0, SHOW).map((r) => (
          <TrackRow
            key={`${r.kind}:${r.id}`}
            id={r.id}
            title={r.title}
            sub={r.sub}
            concertKey={{ tonic: r.key, mode: r.mode }}
            on={pick?.spec.ref === r.id}
            disabled={false}
            onClick={() => void choose(r)}
          >
            {openRef === r.id ? <span className="src exact">In Stand</span> : <span className="src exact">Exact</span>}
          </TrackRow>
        ))}
      </div>
      {shown.length > SHOW && <p className="tnote">{`${shown.length - SHOW} more: narrow the search.`}</p>}
      {shown.length === 0 && <p className="tnote">Nothing matches.</p>}
      {card && <div className="band-dock">{card}</div>}
    </>
  )
}

interface Official {
  n: number
  name: string
  songs: number
}

function IrealImport({ playlists, onDone }: { playlists: string[]; onDone: () => void }) {
  const [official, setOfficial] = useState<Official[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [text, setText] = useState('')

  useEffect(() => {
    fetch(`${API_URL}/ireal/playlists`)
      .then((r) => (r.ok ? (r.json() as Promise<{ playlists: Official[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => setOfficial(j.playlists))
      .catch(() => setOfficial([]))
  }, [])

  const run = async (label: string, get: () => Promise<string>, name?: string) => {
    setBusy(label)
    setMsg('')
    try {
      const s = await importIreal(await get(), name)
      setMsg(
        `${s.name}: ${s.added} added${s.replaced ? `, ${s.replaced} updated` : ''}` +
          (s.withIssues ? ` (${s.withIssues} with bars the importer didn’t fully read)` : '') +
          '.',
      )
      onDone()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    }
    setBusy(null)
  }

  return (
    <div className="tpick" data-testid="ireal-import">
      <span className="lbl">iReal Pro’s playlists</span>
      {official === null ? (
        <p className="tnote">Loading…</p>
      ) : official.length === 0 ? (
        <p className="tnote">Couldn’t reach irealpro.com. Paste a playlist link or pick a file instead.</p>
      ) : (
        <div className="band r">
          {official.map((o) => (
            <button
              key={o.n}
              type="button"
              className="tog"
              disabled={busy !== null}
              onClick={() =>
                void run(o.name, async () => {
                  const r = await fetch(`${API_URL}/ireal/playlists/${o.n}`)
                  if (!r.ok) throw new Error(`Couldn’t fetch ${o.name} (${r.status}).`)
                  return r.text()
                })
              }
            >
              {busy === o.name ? 'Importing…' : `${o.name}${playlists.includes(o.name) ? ' ✓' : ''}`}
            </button>
          ))}
        </div>
      )}
      <span className="lbl">Or paste an irealb:// link</span>
      <div className="addref-row addref">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="irealb://…" autoComplete="off" spellCheck={false} />
        <button type="button" disabled={!text.trim() || busy !== null} onClick={() => void run('paste', async () => text)}>
          Import
        </button>
      </div>
      <label className="lbl">
        Or a file (iReal’s HTML export or a text file with the link)
        <input
          type="file"
          accept=".html,.htm,.txt,text/html,text/plain"
          disabled={busy !== null}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void run('file', () => f.text(), f.name.replace(/\.\w+$/, ''))
            e.target.value = ''
          }}
        />
      </label>
      {msg && <p className="tnote" data-testid="ireal-msg">{msg}</p>}
      {playlists.length > 0 && (
        <>
          <span className="lbl">On this phone</span>
          {playlists.map((pl) => (
            <div key={pl} className="tsec-h">
              <span className="tnote">{pl}</span>
              <button
                type="button"
                className="tlink"
                onClick={() =>
                  void removePlaylist(pl).then(() => {
                    setMsg(`Removed ${pl}.`)
                    onDone()
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
