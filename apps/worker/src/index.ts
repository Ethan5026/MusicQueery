// MusicQueery Worker (D-23): serves the PWA from static assets and the API under /api/*.
// M1: remote device logs (/api/log) and drift-probe reports (/api/report).
// M3: the timeline store (D-17, D-32). GET /api/timelines/:id is public; writes need `Authorization: Bearer <API_SECRET>`.
// M5: the analysis queue. The phone asks for a track to be analysed (POST /api/queue/:id with its Spotify token, checked
// against ALLOWED_SPOTIFY_USERS); the companion's `mqc watch` lists, updates and deletes requests with the secret.

import { Timeline } from '@mq/model'

export interface Env {
  ASSETS: Fetcher
  STORE: KVNamespace
  ALLOWED_ORIGINS: string
  /** `wrangler secret put API_SECRET`; locally from apps/worker/.dev.vars. */
  API_SECRET?: string
  /** Spotify user ids (comma-separated) whose phones may queue analyses. */
  ALLOWED_SPOTIFY_USERS?: string
}

const MAX_LOG_BYTES = 64 * 1024
const MAX_REPORT_BYTES = 2 * 1024 * 1024
const MAX_TIMELINE_BYTES = 4 * 1024 * 1024
const TIMELINE_PREFIX = 'tl:'
/** `spotify:track:<base62>` or `chart:<slug>`, the same ids Timeline.id allows. */
const TIMELINE_ID = /^(?:spotify:track:[A-Za-z0-9]{22}|chart:[A-Za-z0-9._~-]{1,110})$/
const QUEUE_PREFIX = 'q:'
const QUEUE_ID = /^spotify:track:[A-Za-z0-9]{22}$/
const MAX_QUEUE = 200

export type QueueState = 'queued' | 'working' | 'failed'

export interface QueueItem {
  id: string
  title?: string
  artist?: string
  state: QueueState
  error?: string
  requestedAt: string
  updatedAt: string
}

/** The Spotify user behind `token`, if they are on the allow-list. */
export async function spotifyUser(token: string | null, allowed: string | undefined): Promise<string | null> {
  const list = (allowed ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!token || !list.length) return null
  const res = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  const me = (await res.json()) as { id?: string }
  return me.id && list.includes(me.id) ? me.id : null
}

const clip = (v: unknown, n = 200): string | undefined => (typeof v === 'string' && v ? v.slice(0, n) : undefined)

export interface TimelineMeta {
  source: string
  generator?: string
  createdAt: string
  updatedAt: string
  durationMs: number
  chords: number
  bytes: number
}

export function corsHeaders(origin: string | null, allowed: string): Record<string, string> {
  const list = allowed.split(',').map((s) => s.trim())
  const ok = origin !== null && list.includes(origin)
  return ok
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Spotify-Token',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : {}
}

/** Constant-time check of `Authorization: Bearer <secret>`. False when no secret is configured. */
export function isAuthorised(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith('Bearer ')) return false
  const a = new TextEncoder().encode(header.slice(7))
  const b = new TextEncoder().encode(secret)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]!
  return diff === 0
}

async function readBody(req: Request, max: number): Promise<string | null> {
  const text = await req.text()
  return text.length > max ? null : text
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const cors = corsHeaders(req.headers.get('Origin'), env.ALLOWED_ORIGINS)
    const reply = (body: BodyInit | null, status = 200, extra: Record<string, string> = {}) =>
      new Response(body, { status, headers: { ...cors, ...extra } })
    const json = (body: unknown, status = 200) =>
      reply(JSON.stringify(body), status, { 'Content-Type': 'application/json' })
    const authorised = isAuthorised(req.headers.get('Authorization'), env.API_SECRET)

    if (req.method === 'OPTIONS') return reply(null, 204)
    if (url.pathname === '/api/health') return reply('ok')

    // Browsers send Origin on every POST; refuse ones we don't know. The companion uses the bearer secret instead.
    if (req.method === 'POST' && !cors['Access-Control-Allow-Origin'] && !authorised) return reply('origin', 403)

    if (req.method === 'POST' && url.pathname === '/api/log') {
      const text = await readBody(req, MAX_LOG_BYTES)
      if (text === null) return reply('too large', 413)
      try {
        const batch = JSON.parse(text) as { session?: string; lines?: unknown[] }
        for (const line of batch.lines ?? []) console.log(JSON.stringify({ s: batch.session, ...(line as object) }))
      } catch {
        return reply('bad json', 400)
      }
      return reply(null, 204)
    }

    if (req.method === 'POST' && url.pathname === '/api/report') {
      const text = await readBody(req, MAX_REPORT_BYTES)
      if (text === null) return reply('too large', 413)
      const key = `report:${new Date().toISOString()}:${crypto.randomUUID().slice(0, 8)}`
      await env.STORE.put(key, text, { expirationTtl: 60 * 60 * 24 * 90 })
      console.log(JSON.stringify({ report: key, bytes: text.length }))
      return json({ key }, 201)
    }

    if (url.pathname === '/api/queue') {
      if (req.method !== 'GET') return reply('method', 405)
      if (!authorised) return reply('unauthorised', 401)
      const items: QueueItem[] = []
      const page = await env.STORE.list({ prefix: QUEUE_PREFIX })
      for (const k of page.keys) {
        const v = await env.STORE.get(k.name)
        if (v) items.push(JSON.parse(v) as QueueItem)
      }
      items.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
      return json({ queue: items })
    }

    if (url.pathname.startsWith('/api/queue/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/queue/'.length))
      if (!QUEUE_ID.test(id)) return reply('bad id', 400)
      const key = QUEUE_PREFIX + id
      const now = new Date().toISOString()
      const current = async () => {
        const v = await env.STORE.get(key)
        return v ? (JSON.parse(v) as QueueItem) : null
      }

      if (req.method === 'GET') {
        const item = await current()
        if (item) return json(item)
        const done = (await env.STORE.get(TIMELINE_PREFIX + id)) !== null
        return done ? json({ id, state: 'done' }) : reply('not queued', 404)
      }

      if (req.method === 'POST') {
        // The phone has no store secret (D-32): it proves who it is with its Spotify token.
        if (!authorised && !(await spotifyUser(req.headers.get('X-Spotify-Token'), env.ALLOWED_SPOTIFY_USERS)))
          return reply('unauthorised', 401)
        if ((await env.STORE.get(TIMELINE_PREFIX + id)) !== null) return json({ id, state: 'done' })
        const text = await readBody(req, 4096)
        let body: Record<string, unknown>
        try {
          body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
        } catch {
          return reply('bad json', 400)
        }
        const prev = await current()
        if (!prev && (await env.STORE.list({ prefix: QUEUE_PREFIX })).keys.length >= MAX_QUEUE) return reply('queue full', 429)
        const title = clip(body.title) ?? prev?.title
        const artist = clip(body.artist) ?? prev?.artist
        const item: QueueItem = {
          id,
          ...(title ? { title } : {}),
          ...(artist ? { artist } : {}),
          // asking again retries a failed one; a running one carries on
          state: prev?.state === 'working' ? 'working' : 'queued',
          requestedAt: prev?.requestedAt ?? now,
          updatedAt: now,
        }
        await env.STORE.put(key, JSON.stringify(item))
        console.log(JSON.stringify({ queue: id, state: item.state }))
        return json(item, prev ? 200 : 201)
      }

      if (!authorised) return reply('unauthorised', 401)
      if (req.method === 'DELETE') {
        await env.STORE.delete(key)
        return reply(null, 204)
      }
      if (req.method === 'PUT') {
        const prev = await current()
        if (!prev) return reply('not queued', 404)
        let body: Record<string, unknown>
        try {
          body = JSON.parse((await readBody(req, 4096)) ?? '') as Record<string, unknown>
        } catch {
          return reply('bad json', 400)
        }
        const state = body.state
        if (state !== 'queued' && state !== 'working' && state !== 'failed') return reply('bad state', 400)
        const error = state === 'failed' ? clip(body.error, 500) : undefined
        const item: QueueItem = { ...prev, state, updatedAt: now }
        if (error) item.error = error
        else delete item.error
        await env.STORE.put(key, JSON.stringify(item))
        return json(item)
      }
      return reply('method', 405)
    }

    if (url.pathname === '/api/timelines') {
      if (req.method !== 'GET') return reply('method', 405)
      if (!authorised) return reply('unauthorised', 401)
      const items: { id: string; meta: TimelineMeta | null }[] = []
      let cursor: string | undefined
      do {
        const page = await env.STORE.list<TimelineMeta>({ prefix: TIMELINE_PREFIX, cursor })
        for (const k of page.keys) items.push({ id: k.name.slice(TIMELINE_PREFIX.length), meta: k.metadata ?? null })
        cursor = page.list_complete ? undefined : page.cursor
      } while (cursor)
      return json({ timelines: items })
    }

    if (url.pathname.startsWith('/api/timelines/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/timelines/'.length))
      if (!TIMELINE_ID.test(id)) return reply('bad id', 400)
      const key = TIMELINE_PREFIX + id

      if (req.method === 'GET') {
        const text = await env.STORE.get(key)
        if (text === null) return reply('not found', 404, { 'Cache-Control': 'no-store' })
        return reply(text, 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' })
      }
      if (!authorised) return reply('unauthorised', 401)

      if (req.method === 'DELETE') {
        await env.STORE.delete(key)
        return reply(null, 204)
      }
      if (req.method === 'PUT') {
        const text = await readBody(req, MAX_TIMELINE_BYTES)
        if (text === null) return reply('too large', 413)
        let body: unknown
        try {
          body = JSON.parse(text)
        } catch {
          return reply('bad json', 400)
        }
        const parsed = Timeline.safeParse(body)
        if (!parsed.success) return json({ error: 'invalid timeline', issues: parsed.error.issues.slice(0, 20) }, 422)
        if (parsed.data.id !== id) return json({ error: `body id ${parsed.data.id} does not match ${id}` }, 422)
        const tl = parsed.data
        const meta: TimelineMeta = {
          source: tl.source,
          generator: tl.generator,
          createdAt: tl.createdAt,
          updatedAt: new Date().toISOString(),
          durationMs: tl.durationMs,
          chords: tl.chords.length,
          bytes: text.length,
        }
        await env.STORE.put(key, text, { metadata: meta })
        await env.STORE.delete(QUEUE_PREFIX + id) // a queued analysis is done
        console.log(JSON.stringify({ timeline: id, ...meta }))
        return json({ id, ...meta })
      }
      return reply('method', 405)
    }

    if (url.pathname.startsWith('/api/')) return reply('not found', 404)
    return env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env>
