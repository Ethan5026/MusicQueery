// MusicQueery Worker (D-23): serves the PWA from static assets and the API under /api/*.
// M1: remote device logs (/api/log) and drift-probe reports (/api/report).
// M3 adds /api/timelines/:id behind the bearer secret (D-17).

export interface Env {
  ASSETS: Fetcher
  STORE: KVNamespace
  ALLOWED_ORIGINS: string
}

const MAX_LOG_BYTES = 64 * 1024
const MAX_REPORT_BYTES = 2 * 1024 * 1024

export function corsHeaders(origin: string | null, allowed: string): Record<string, string> {
  const list = allowed.split(',').map((s) => s.trim())
  const ok = origin !== null && list.includes(origin)
  return ok
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : {}
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

    if (req.method === 'OPTIONS') return reply(null, 204)
    if (url.pathname === '/api/health') return reply('ok')

    // Browsers send Origin on every POST; refuse ones we don't know.
    if (req.method === 'POST' && !cors['Access-Control-Allow-Origin']) return reply('origin', 403)

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
      return reply(JSON.stringify({ key }), 201, { 'Content-Type': 'application/json' })
    }

    if (url.pathname.startsWith('/api/')) return reply('not found', 404)
    return env.ASSETS.fetch(req)
  },
} satisfies ExportedHandler<Env>
