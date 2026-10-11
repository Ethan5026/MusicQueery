// Tracks → On Spotify (D-12): search Spotify for play-along and minus-one recordings and play one on the active
// device; Stand follows it like any song, with chords once it is analysed (the PC's queue, M5). Each result shows
// its analysis state from the store (GET /api/status). Search is a player-side call, not a playlist read, so the
// playlist quota blocks of D-35 don't stop it.
import { useState } from 'react'
import { clock, useApp, useSession } from '../../services'
import { type SearchTrack, player, searchTracks } from '../../spotify/api'
import { login } from '../../spotify/auth'
import { idbSet } from '../../store/idb'
import { type InboxState, STATE_LABEL, fetchStates } from '../../timeline/inbox'
import { AnalyseButton } from '../AnalyseButton'
import { fmt } from '../stand/Stand'
import { TrackRow } from './Songs'

const PRESETS = ['play-along', 'backing track', 'minus one', 'jam track']
const PILL: Record<InboxState, string> = { analysed: 'exact', working: 'live', queued: 'pred', new: 'pred', failed: 'fail' }

export function OnSpotifyPanel() {
  const authed = useApp((s) => s.authed)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchTrack[] | null>(null)
  const [states, setStates] = useState<Record<string, InboxState>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [picked, setPicked] = useState<SearchTrack | null>(null)

  const search = async (text: string) => {
    if (!text.trim()) return
    setBusy(true)
    setMsg('')
    setPicked(null)
    try {
      const r = await searchTracks(text.trim())
      setResults(r)
      setStates(await fetchStates(r.map((t) => `spotify:track:${t.id}`)))
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  const play = async (t: SearchTrack) => {
    setMsg('')
    const id = `spotify:track:${t.id}`
    void idbSet('tracks', id, { id, title: t.title, artist: t.artist })
    try {
      await player.playTrack(t.id, clock.last?.deviceId)
      clock.pollNow()
      useSession.getState().setTab('stand')
    } catch (err) {
      setMsg(
        String(err).includes('404')
          ? 'No Spotify device is awake. Open Spotify on the phone or the TV, then try again.'
          : `Spotify refused to play it: ${String(err)}`,
      )
    }
  }

  if (!authed)
    return (
      <div className="empty">
        <p>Log in to Spotify to search for play-alongs and backing tracks.</p>
        <button type="button" className="tlink" onClick={() => void login().catch(() => {})}>
          Log in
        </button>
      </div>
    )

  return (
    <>
      <form
        className="addref"
        onSubmit={(e) => {
          e.preventDefault()
          void search(q)
        }}
      >
        <div className="addref-row">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tune, key or style: minor blues in C"
            aria-label="Search Spotify"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" disabled={busy || !q.trim()}>
            {busy ? '…' : 'Search'}
          </button>
        </div>
      </form>
      <div className="band r">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className="tog"
            aria-pressed={q.includes(p)}
            onClick={() => {
              const next = q.includes(p) ? q.replace(p, '').replace(/\s+/g, ' ').trim() : `${q.trim()} ${p}`.trim()
              setQ(next)
              void search(next)
            }}
          >
            {p}
          </button>
        ))}
      </div>
      <p className="tnote">Plays through Spotify on the active device. Analysed tracks show chords on Stand; others can be queued for the PC.</p>
      {msg && <p className="tmsg">{msg}</p>}
      {results?.length === 0 && <p className="tnote">Nothing found.</p>}
      <div className="tlist" role="list">
        {results?.map((t) => {
          const id = `spotify:track:${t.id}`
          const st = states[id]
          return (
            <TrackRow
              key={t.id}
              id={id}
              title={t.title}
              sub={`${t.artist} · ${fmt(t.durationMs)}`}
              on={picked?.id === t.id}
              disabled={false}
              onClick={() => setPicked(picked?.id === t.id ? null : t)}
            >
              {st ? <span className={`src ${PILL[st]}`}>{st === 'new' ? 'Needs a listen' : STATE_LABEL[st]}</span> : null}
            </TrackRow>
          )
        })}
      </div>
      {picked && (
        <div className="tpick">
          <p className="tt">{picked.title}</p>
          <div className="addref-row addref">
            <button type="button" onClick={() => void play(picked)}>
              Play on Spotify
            </button>
          </div>
          {states[`spotify:track:${picked.id}`] !== 'analysed' && (
            <AnalyseButton key={picked.id} id={`spotify:track:${picked.id}`} title={picked.title} artist={picked.artist} />
          )}
        </div>
      )}
    </>
  )
}
