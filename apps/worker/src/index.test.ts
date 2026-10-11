import { expect, test, vi } from 'vitest'
import worker, { type Env, corsHeaders, isAuthorised } from './index'

const allowed = 'https://musicqueery.ethangruening.workers.dev,http://127.0.0.1:5173'

test('allows listed origins', () => {
  expect(corsHeaders('https://musicqueery.ethangruening.workers.dev', allowed)['Access-Control-Allow-Origin']).toBe(
    'https://musicqueery.ethangruening.workers.dev',
  )
  expect(corsHeaders('http://127.0.0.1:5173', allowed)['Access-Control-Allow-Origin']).toBeTruthy()
})

test('refuses unknown origins', () => {
  expect(corsHeaders('https://evil.example', allowed)).toEqual({})
  expect(corsHeaders('https://musicqueery.ethangruening.workers.dev.evil.example', allowed)).toEqual({})
  expect(corsHeaders(null, allowed)).toEqual({})
})

// ---------------------------------------------------------------- timeline store (M3)

class MemoryKV {
  data = new Map<string, { value: string; metadata?: unknown }>()
  async get(key: string) {
    return this.data.get(key)?.value ?? null
  }
  async put(key: string, value: string, opts?: { metadata?: unknown }) {
    this.data.set(key, { value, metadata: opts?.metadata })
  }
  async delete(key: string) {
    this.data.delete(key)
  }
  async list({ prefix }: { prefix: string }) {
    const keys = [...this.data].filter(([k]) => k.startsWith(prefix)).map(([name, v]) => ({ name, metadata: v.metadata }))
    return { keys, list_complete: true, cursor: '' }
  }
}

const SECRET = 'test-secret-0123456789'
const ID = 'spotify:track:4uLU6hMCjMI75M1A2tKUQC'

function makeEnv(): Env & { STORE: MemoryKV } {
  return {
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    STORE: new MemoryKV() as unknown as KVNamespace & MemoryKV,
    ALLOWED_ORIGINS: allowed,
    API_SECRET: SECRET,
  }
}

function timeline(id = ID) {
  return {
    schema: 'mq.timeline/1',
    id,
    source: 'analysed',
    durationMs: 4000,
    createdAt: '2026-10-10T12:00:00.000Z',
    generator: 'test',
    meter: { num: 4, den: 4 },
    beats: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500],
    bars: [
      { startMs: 0, number: 1 },
      { startMs: 2000, number: 2 },
    ],
    chords: [
      { startMs: 0, endMs: 2000, symbol: 'Dm7', confidence: 0.8 },
      { startMs: 2000, endMs: 4000, symbol: 'G7' },
    ],
    keys: [{ startMs: 0, endMs: 4000, tonic: 'C', mode: 'major' }],
    tempo: [{ startMs: 0, bpm: 120 }],
    edits: [],
  }
}

const call = (env: Env, method: string, path: string, init: { body?: unknown; auth?: string; origin?: string } = {}) => {
  const headers: Record<string, string> = {}
  if (init.auth) headers.Authorization = `Bearer ${init.auth}`
  if (init.origin) headers.Origin = init.origin
  const body = init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
  return worker.fetch(new Request(`https://x.test${path}`, { method, headers, body }), env)
}

test('bearer check is exact', () => {
  expect(isAuthorised(`Bearer ${SECRET}`, SECRET)).toBe(true)
  expect(isAuthorised(`Bearer ${SECRET}x`, SECRET)).toBe(false)
  expect(isAuthorised(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false)
  expect(isAuthorised(SECRET, SECRET)).toBe(false)
  expect(isAuthorised(null, SECRET)).toBe(false)
  expect(isAuthorised('Bearer ', undefined)).toBe(false)
  expect(isAuthorised('Bearer ', '')).toBe(false)
})

test('PUT then GET a timeline', async () => {
  const env = makeEnv()
  const put = await call(env, 'PUT', `/api/timelines/${ID}`, { body: timeline(), auth: SECRET })
  expect(put.status).toBe(200)
  expect(await put.json()).toMatchObject({ id: ID, source: 'analysed', chords: 2 })

  const get = await call(env, 'GET', `/api/timelines/${encodeURIComponent(ID)}`)
  expect(get.status).toBe(200)
  expect(get.headers.get('Content-Type')).toBe('application/json')
  expect(await get.json()).toEqual(timeline())

  const list = await call(env, 'GET', '/api/timelines', { auth: SECRET })
  expect(((await list.json()) as { timelines: { id: string }[] }).timelines.map((t) => t.id)).toEqual([ID])
})

test('writes and the list need the secret; reads do not', async () => {
  const env = makeEnv()
  expect((await call(env, 'PUT', `/api/timelines/${ID}`, { body: timeline() })).status).toBe(401)
  expect((await call(env, 'PUT', `/api/timelines/${ID}`, { body: timeline(), auth: 'nope' })).status).toBe(401)
  // An allowed Origin is not enough to write.
  const origin = 'https://musicqueery.ethangruening.workers.dev'
  expect((await call(env, 'PUT', `/api/timelines/${ID}`, { body: timeline(), origin })).status).toBe(401)
  expect((await call(env, 'GET', '/api/timelines')).status).toBe(401)
  expect((await call(env, 'GET', `/api/timelines/${ID}`)).status).toBe(404)
  await call(env, 'PUT', `/api/timelines/${ID}`, { body: timeline(), auth: SECRET })
  expect((await call(env, 'DELETE', `/api/timelines/${ID}`)).status).toBe(401)
  expect((await call(env, 'DELETE', `/api/timelines/${ID}`, { auth: SECRET })).status).toBe(204)
  expect((await call(env, 'GET', `/api/timelines/${ID}`)).status).toBe(404)
})

test('PUT rejects invalid timelines and mismatched ids', async () => {
  const env = makeEnv()
  const bad = { ...timeline(), keys: [{ startMs: 0, endMs: 1, tonic: 'H', mode: 'major' }] }
  const r1 = await call(env, 'PUT', `/api/timelines/${ID}`, { body: bad, auth: SECRET })
  expect(r1.status).toBe(422)
  expect(JSON.stringify(await r1.json())).toContain('tonic')
  const other = 'spotify:track:0000000000000000000000'
  expect((await call(env, 'PUT', `/api/timelines/${other}`, { body: timeline(), auth: SECRET })).status).toBe(422)
  expect((await call(env, 'PUT', `/api/timelines/${ID}`, { body: '{nope', auth: SECRET })).status).toBe(400)
  expect((await call(env, 'GET', '/api/timelines/spotify:track:short')).status).toBe(400)
  expect((await call(env, 'GET', '/api/timelines/..%2Freport')).status).toBe(400)
  expect(env.STORE.data.size).toBe(0)
})

test('chart timelines use chart: ids', async () => {
  const env = makeEnv()
  const id = 'chart:ireal.all-the-things-you-are'
  expect((await call(env, 'PUT', `/api/timelines/${id}`, { body: timeline(id), auth: SECRET })).status).toBe(200)
  expect((await call(env, 'GET', `/api/timelines/${id}`)).status).toBe(200)
})

test('the companion can log with the secret instead of an Origin', async () => {
  const env = makeEnv()
  const body = { session: 'companion', lines: [{ msg: 'hi' }] }
  expect((await call(env, 'POST', '/api/log', { body })).status).toBe(403)
  expect((await call(env, 'POST', '/api/log', { body, auth: SECRET })).status).toBe(204)
})

// ---------------------------------------------------------------- analysis queue (M5)

const ORIGIN = 'https://musicqueery.ethangruening.workers.dev'
const QID = 'spotify:track:7iN1s7xHE4ifF5povM6A48'

function phone(env: Env, method: string, token: string | null, body?: unknown) {
  const headers: Record<string, string> = { Origin: ORIGIN }
  if (token) headers['X-Spotify-Token'] = token
  return worker.fetch(
    new Request(`https://x.test/api/queue/${QID}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  )
}

/** Spotify /v1/me: token "good" is the allow-listed user, "other" is someone else, anything else is invalid. */
function mockSpotify() {
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const auth = new Headers(init.headers).get('Authorization')
    if (auth === 'Bearer good') return new Response(JSON.stringify({ id: 'ethan_gruening' }))
    if (auth === 'Bearer other') return new Response(JSON.stringify({ id: 'someone' }))
    return new Response('{}', { status: 401 })
  })
}

test('the phone queues a track with an allow-listed Spotify token; others are refused', async () => {
  mockSpotify()
  const env = { ...makeEnv(), ALLOWED_SPOTIFY_USERS: 'ethan_gruening' }
  expect((await phone(env, 'POST', null)).status).toBe(401)
  expect((await phone(env, 'POST', 'bad')).status).toBe(401)
  expect((await phone(env, 'POST', 'other')).status).toBe(401)
  expect((await phone(env, 'GET', null)).status).toBe(404)
  const r = await phone(env, 'POST', 'good', { title: 'Let It Be', artist: 'The Beatles' })
  expect(r.status).toBe(201)
  expect(await r.json()).toMatchObject({ id: QID, state: 'queued', title: 'Let It Be' })
  // status is public, like timelines
  expect(await (await phone(env, 'GET', null)).json()).toMatchObject({ state: 'queued' })
  // a second request keeps its place
  expect((await phone(env, 'POST', 'good', {})).status).toBe(200)
  vi.unstubAllGlobals()
})

test('the companion lists, marks and finishes requests; uploading the timeline clears it', async () => {
  mockSpotify()
  const env = { ...makeEnv(), ALLOWED_SPOTIFY_USERS: 'ethan_gruening' }
  await phone(env, 'POST', 'good', { title: 'Let It Be' })
  expect((await call(env, 'GET', '/api/queue')).status).toBe(401)
  const list = (await (await call(env, 'GET', '/api/queue', { auth: SECRET })).json()) as { queue: { id: string }[] }
  expect(list.queue.map((q) => q.id)).toEqual([QID])
  expect((await call(env, 'PUT', `/api/queue/${QID}`, { body: { state: 'working' } })).status).toBe(401)
  const failed = await call(env, 'PUT', `/api/queue/${QID}`, { body: { state: 'failed', error: 'capture failed' }, auth: SECRET })
  expect(await failed.json()).toMatchObject({ state: 'failed', error: 'capture failed' })
  // asking again from the phone retries it
  expect(await (await phone(env, 'POST', 'good', {})).json()).toMatchObject({ state: 'queued' })
  expect((await call(env, 'PUT', `/api/timelines/${QID}`, { body: timeline(QID), auth: SECRET })).status).toBe(200)
  expect(await (await phone(env, 'GET', null)).json()).toEqual({ id: QID, state: 'done' })
  expect(await (await phone(env, 'POST', 'good', {})).json()).toEqual({ id: QID, state: 'done' })
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------- playlist inbox (M5b)

const PLAYLIST = '37i9dQZF1DXcBWIGoYBM5M'
const NEW_ID = 'spotify:track:0000000000000000000000'
const FAIL_ID = 'spotify:track:1111111111111111111111'

test('the companion mirrors the inbox; the phone reads it with each song’s state', async () => {
  const env = makeEnv()
  expect((await call(env, 'GET', '/api/inbox')).status).toBe(404)
  const doc = {
    playlistId: PLAYLIST,
    name: 'MusicQueery inbox',
    snapshotId: 'snap1',
    tracks: [
      { id: ID, title: 'Analysed one', artist: 'A' },
      { id: QID, title: 'Let It Be', artist: 'The Beatles' },
      { id: NEW_ID, title: 'New one' },
      { id: FAIL_ID, title: 'Broken' },
      { id: QID, title: 'Let It Be (added twice)' },
    ],
  }
  expect((await call(env, 'PUT', '/api/inbox', { body: doc })).status).toBe(401)
  const put = await call(env, 'PUT', '/api/inbox', { body: doc, auth: SECRET })
  expect(await put.json()).toMatchObject({ playlistId: PLAYLIST, tracks: 4 })

  await call(env, 'PUT', `/api/timelines/${ID}`, { body: timeline(ID), auth: SECRET })
  await call(env, 'POST', `/api/queue/${QID}`, { body: { title: 'Let It Be' }, auth: SECRET })
  await call(env, 'POST', `/api/queue/${FAIL_ID}`, { body: {}, auth: SECRET })
  await call(env, 'PUT', `/api/queue/${FAIL_ID}`, { body: { state: 'failed', error: 'capture failed' }, auth: SECRET })

  const got = (await (await call(env, 'GET', '/api/inbox')).json()) as { name: string; tracks: { id: string; state: string; error?: string }[] }
  expect(got.name).toBe('MusicQueery inbox')
  expect(got.tracks.map((t) => [t.id, t.state])).toEqual([
    [ID, 'analysed'],
    [QID, 'queued'],
    [NEW_ID, 'new'],
    [FAIL_ID, 'failed'],
  ])
  expect(got.tracks[3]!.error).toBe('capture failed')

  // a quota block is recorded with the tracks it last saw
  await call(env, 'PUT', '/api/inbox', { body: { ...doc, blockedUntil: '2026-10-12T10:00:00.000Z' }, auth: SECRET })
  expect(await (await call(env, 'GET', '/api/inbox')).json()).toMatchObject({ blockedUntil: '2026-10-12T10:00:00.000Z' })
  expect((await call(env, 'DELETE', '/api/inbox', { auth: SECRET })).status).toBe(204)
  expect((await call(env, 'GET', '/api/inbox')).status).toBe(404)
})

test('a bad inbox is refused', async () => {
  const env = makeEnv()
  const put = (body: unknown) => call(env, 'PUT', '/api/inbox', { body, auth: SECRET })
  expect((await put({ playlistId: 'nope', tracks: [] })).status).toBe(422)
  expect((await put({ playlistId: PLAYLIST })).status).toBe(422)
  expect((await put({ playlistId: PLAYLIST, tracks: [{ id: 'spotify:episode:1111111111111111111111' }] })).status).toBe(422)
  expect((await put({ playlistId: PLAYLIST, tracks: Array.from({ length: 301 }, () => ({ id: ID })) })).status).toBe(422)
  expect((await put({ playlistId: PLAYLIST, tracks: [] })).status).toBe(200)
})
