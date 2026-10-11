// Tracks → Songs. M5b: the playlist inbox (songs added to a Spotify playlist are analysed on the PC; each with its
// state), then the timelines cached on this phone (M4), which also play on the manual clock.
import type { Timeline } from '@mq/model'
import { note, noteName, pc, toWritten } from '@mq/theory'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useSession } from '../../services'
import { idbGet } from '../../store/idb'
import { useSettings } from '../../store/settings'
import {
  type InboxResult,
  type InboxSong,
  type InboxState,
  STATE_LABEL,
  blockedUntil,
  cachedInbox,
  fetchInbox,
} from '../../timeline/inbox'
import { DEMO_ID, type TrackMeta, demoTimeline, parseTrackRef, recordedList } from '../../timeline/library'
import type { QueueStatus } from '../../timeline/queue'
import { AnalyseButton } from '../AnalyseButton'
import { Acc } from '../atoms'
import { homeKey } from '../stand/view'

interface Row extends TrackMeta {
  timeline: Timeline | null
}

/** Circle-of-fifths hue for a key swatch (the sketch's fifthsHue). */
export const fifthsHue = (tonic: string): number => ((pc(note(tonic)) * 7) % 12) * 30 + 25

const PILL: Record<InboxState, string> = { analysed: 'exact', working: 'live', queued: 'pred', new: 'pred', failed: 'fail' }

const when = (t: number | string | Date): string =>
  new Date(t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })

/** A queue status from AnalyseButton as an inbox state (null: nothing new to show). */
function stateOf(s: QueueStatus): InboxState | null {
  if (s.state === 'done') return 'analysed'
  if (s.state === 'queued' || s.state === 'working' || s.state === 'failed') return s.state
  return null
}

/** Timelines already on the phone for the inbox's analysed songs (for their key swatches). */
async function analysedOnPhone(r: InboxResult): Promise<Record<string, Timeline>> {
  const tls: Record<string, Timeline> = {}
  if (r.status !== 'ok') return tls
  for (const t of r.inbox.tracks) {
    const tl = t.state === 'analysed' ? await idbGet<Timeline>('timelines', t.id) : undefined
    if (tl) tls[t.id] = tl
  }
  return tls
}

export function TrackRow(p: {
  id: string
  title: string
  sub: string
  timeline?: Timeline | null | undefined
  /** concert key, when there is no timeline (backing tracks) */
  concertKey?: { tonic: string; mode: 'major' | 'minor' }
  /** a word under the key instead of the mode (Drills: "Dorian") */
  keyNote?: string
  on: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  const inst = useSettings((s) => s.instrument)
  const k = p.timeline
    ? homeKey(p.timeline, inst)
    : p.concertKey
      ? { tonic: noteName(toWritten(note(p.concertKey.tonic), inst)), mode: p.concertKey.mode }
      : null
  return (
    <button
      type="button"
      role="listitem"
      className={`trow${p.on ? ' on' : ''}`}
      onClick={p.onClick}
      disabled={p.disabled}
      data-id={p.id}
    >
      <span className={`tkey${k ? '' : ' none'}`} style={k ? { ['--h' as string]: fifthsHue(k.tonic) } : undefined}>
        {k ? <Acc text={k.tonic} /> : '·'}
        <small>{p.keyNote ?? (k ? k.mode : '')}</small>
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="tt">{p.title}</span>
        <span className="tm">{p.sub}</span>
      </span>
      {p.children}
    </button>
  )
}

export function SongsPanel() {
  const { id: openId, open, setTab } = useSession()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [inbox, setInbox] = useState<InboxResult | null>(null)
  const [cachedTl, setCachedTl] = useState<Record<string, Timeline>>({})
  const [picked, setPicked] = useState<InboxSong | null>(null)
  const [ref, setRef] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const refresh = () =>
    void recordedList().then(async (list) =>
      setRows(
        await Promise.all(
          list.map(async (m) => ({
            ...m,
            timeline: m.id === DEMO_ID ? demoTimeline() : ((await idbGet<Timeline>('timelines', m.id)) ?? null),
          })),
        ),
      ),
    )
  useEffect(refresh, [])

  const loadInbox = useCallback(
    () =>
      fetchInbox().then(async (r) => {
        const tls = await analysedOnPhone(r)
        setInbox(r)
        setCachedTl(tls)
      }),
    [],
  )
  const recheck = async () => {
    setChecking(true)
    await loadInbox()
    setChecking(false)
  }
  useEffect(() => {
    void cachedInbox().then((c) => c && setInbox((cur) => cur ?? c))
    void loadInbox()
    const onVisible = () => document.visibilityState === 'visible' && void loadInbox()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadInbox])

  const onStatus = useCallback((id: string, s: QueueStatus) => {
    const state = stateOf(s)
    if (!state) return
    setInbox((cur) =>
      cur?.status === 'ok' && cur.inbox.tracks.some((t) => t.id === id && t.state !== state)
        ? { ...cur, inbox: { ...cur.inbox, tracks: cur.inbox.tracks.map((t) => (t.id === id ? { ...t, state } : t)) } }
        : cur,
    )
  }, [])

  const go = async (id: string) => {
    setBusy(id)
    setMsg('')
    setMissing(null)
    setPicked(null)
    const r = await open(id)
    setBusy(null)
    if (r.status === 'missing' && id.startsWith('spotify:track:')) setMissing(id)
    if (r.status === 'ok') {
      refresh()
      setTab('stand')
    } else
      setMsg(
        r.status === 'missing'
          ? 'That track hasn’t been analysed yet.'
          : `Couldn’t open it: ${r.message}`,
      )
  }

  const songs = inbox?.status === 'ok' ? inbox.inbox.tracks : []
  const inInbox = new Set(songs.map((t) => t.id))
  const recorded = rows?.filter((r) => !inInbox.has(r.id))
  const blocked = inbox?.status === 'ok' ? blockedUntil(inbox.inbox) : null
  const analysed = songs.filter((t) => t.state === 'analysed').length

  return (
    <>
      <p className="tnote">
        Play anything on Spotify and Stand follows it. Analysed tracks also play on the app’s own clock, with the play
        button and the slider on Stand.
      </p>

      <section className="tsec" data-testid="inbox">
        <div className="tsec-h">
          <h2 className="lbl">
            Inbox{inbox?.status === 'ok' && inbox.inbox.name ? ` · ${inbox.inbox.name}` : ''}
          </h2>
          {inbox?.status === 'ok' && <span className="tcount">{`${analysed} of ${songs.length} analysed`}</span>}
          <button type="button" className="tlink" onClick={() => void recheck()} disabled={checking}>
            {checking ? 'Checking…' : 'Refresh'}
          </button>
        </div>
        {inbox === null ? null : inbox.status === 'none' ? (
          <p className="tnote">
            No inbox yet. On the PC run <code>pnpm companion inbox set &lt;playlist link&gt;</code>; songs you then add
            to that Spotify playlist are analysed automatically.
          </p>
        ) : inbox.status === 'error' ? (
          <p className="tmsg">Couldn’t load the inbox: {inbox.message}</p>
        ) : (
          <p className="tnote">
            {blocked
              ? `Spotify is refusing the PC’s playlist reads until ${when(blocked)}; songs added since then show up after that.`
              : inbox.stale
                ? `Offline: the list as of ${when(inbox.fetchedAt)}.`
                : 'Add songs to this playlist in any Spotify app: the PC queues them within 10 minutes and analyses them while nothing is playing.'}
          </p>
        )}
        {songs.length > 0 && (
          <div className="tlist" role="list">
            {songs.map((t) => (
              <TrackRow
                key={t.id}
                id={t.id}
                title={t.title || t.id}
                sub={t.artist ?? ''}
                timeline={cachedTl[t.id]}
                on={t.id === openId || t.id === picked?.id}
                disabled={busy !== null}
                onClick={() => (t.state === 'analysed' ? void go(t.id) : setPicked(picked?.id === t.id ? null : t))}
              >
                {busy === t.id ? (
                  <span className="src pred">Opening…</span>
                ) : (
                  <span className={`src ${PILL[t.state]}`}>{STATE_LABEL[t.state]}</span>
                )}
              </TrackRow>
            ))}
          </div>
        )}
        {picked && (
          <div className="tpick">
            <p className="tt">{picked.title || picked.id}</p>
            {picked.state === 'new' && (
              <p className="tnote">In the playlist, but not queued yet (the PC hasn’t seen it, or the queue was full).</p>
            )}
            <AnalyseButton
              key={picked.id}
              id={picked.id}
              {...(picked.title ? { title: picked.title } : {})}
              {...(picked.artist ? { artist: picked.artist } : {})}
              onStatus={(s) => onStatus(picked.id, s)}
            />
          </div>
        )}
      </section>

      <section className="tsec">
        {songs.length > 0 && <h2 className="lbl">On this phone</h2>}
        <div className="tlist" role="list">
          {recorded?.map((r) => (
            <TrackRow
              key={r.id}
              id={r.id}
              title={r.title}
              sub={r.artist ?? r.id}
              timeline={r.timeline}
              on={r.id === openId}
              disabled={busy !== null}
              onClick={() => void go(r.id)}
            >
              {busy === r.id ? (
                <span className="src pred">Opening…</span>
              ) : r.timeline ? (
                <span className="src exact">{r.timeline.source === 'exact' ? 'Exact' : 'Analysed'}</span>
              ) : (
                <span className="src pred">Download</span>
              )}
            </TrackRow>
          ))}
        </div>
      </section>
      <form
        className="addref"
        onSubmit={(e) => {
          e.preventDefault()
          const id = parseTrackRef(ref)
          if (!id) return setMsg('Paste a Spotify track link, URI or ID.')
          void go(id)
        }}
      >
        <label className="lbl" htmlFor="ref">
          Open an analysed Spotify track
        </label>
        <div className="addref-row">
          <input
            id="ref"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="open.spotify.com/track/…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button type="submit" disabled={busy !== null}>
            Open
          </button>
        </div>
      </form>
      {msg && <p className="tmsg">{msg}</p>}
      {missing && <AnalyseButton id={missing} />}
    </>
  )
}
