// MusicQueery API. M1: remote device logs (/log) and drift-probe reports (/report).
// M3 adds /timelines/:id behind the bearer secret (D-17).

export interface Env {
  STORE: KVNamespace
  ALLOWED_ORIGINS: string
}

const MAX_LOG_BYTES = 64 * 1024
const MAX_REPORT_BYTES = 2 * 1024 * 1024

export function corsHeaders(origin: string | null, allowed: string): Record<string, string> {
  const list = allowed.split(',').map((s) => s.trim())
  // Pages preview deployments live on <hash>.musicqueery.pages.dev.
  const ok = origin !== null && (list.includes(origin) || /^https:\/\/[a-z0-9-]+\.musicqueery\.pages\.dev$/.test(origin))
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
    if (url.pathname === '/health') return reply('ok')

    // Browsers send Origin on cross-site POSTs; refuse ones we don't know.
    if (req.method === 'POST' && !cors['Access-Control-Allow-Origin']) return reply('origin', 403)

    if (req.method === 'POST' && url.pathname === '/log') {
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

    if (req.method === 'POST' && url.pathname === '/report') {
      const text = await readBody(req, MAX_REPORT_BYTES)
      if (text === null) return reply('too large', 413)
      const key = `report:${new Date().toISOString()}:${crypto.randomUUID().slice(0, 8)}`
      await env.STORE.put(key, text, { expirationTtl: 60 * 60 * 24 * 90 })
      console.log(JSON.stringify({ report: key, bytes: text.length }))
      return reply(JSON.stringify({ key }), 201, { 'Content-Type': 'application/json' })
    }

    return reply('not found', 404)
  },
} satisfies ExportedHandler<Env>
