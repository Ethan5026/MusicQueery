// Spotify Authorization Code + PKCE, entirely in the browser (no client secret).
// SP1: everything about the round trip is logged, because the iOS Home Screen app may get the
// redirect back in a different browsing context with different storage.

import { SPOTIFY_CLIENT_ID, SPOTIFY_SCOPES, isStandalone, redirectUri } from '../config'
import { log } from '../debug/log'
import { codeChallenge, randomString } from './pkce'

const PKCE_KEY = 'mq.auth.pkce'
const TOKENS_KEY = 'mq.auth.tokens'
const SP1_KEY = 'mq.sp1'

export interface Tokens {
  accessToken: string
  refreshToken: string
  /** Wall clock ms. */
  expiresAt: number
  scope: string
  /** First authorisation (refresh tokens expire 6 months after it, since 2026-06). */
  grantedAt: number
}

interface PendingLogin {
  verifier: string
  state: string
  createdAt: number
  standalone: boolean
}

export interface Sp1Record {
  loginStartedStandalone: boolean | null
  callbackStandalone: boolean
  verifierFound: boolean
  stateMatched: boolean
  exchanged: boolean
  error?: string
  at: number
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadTokens(): Tokens | null {
  return read<Tokens>(TOKENS_KEY)
}

export function sp1Record(): Sp1Record | null {
  return read<Sp1Record>(SP1_KEY)
}

export function logout(): void {
  localStorage.removeItem(TOKENS_KEY)
  log('info', 'auth.logout')
}

export async function login(): Promise<void> {
  if (!SPOTIFY_CLIENT_ID) throw new Error('VITE_SPOTIFY_CLIENT_ID is not set')
  const verifier = randomString(64)
  const state = randomString(16)
  const pending: PendingLogin = { verifier, state, createdAt: Date.now(), standalone: isStandalone() }
  write(PKCE_KEY, pending)
  const url = new URL('https://accounts.spotify.com/authorize')
  url.search = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SPOTIFY_SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
  }).toString()
  log('info', 'auth.login', { standalone: pending.standalone, redirect: redirectUri() })
  location.assign(url.toString())
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, ...body }),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`token ${res.status}: ${String(json.error ?? '')} ${String(json.error_description ?? '')}`.trim())
  const prev = loadTokens()
  return {
    accessToken: String(json.access_token),
    // PKCE refresh tokens rotate; keep the old one if none came back.
    refreshToken: String(json.refresh_token ?? prev?.refreshToken ?? ''),
    expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000,
    scope: String(json.scope ?? ''),
    grantedAt: body.grant_type === 'authorization_code' ? Date.now() : (prev?.grantedAt ?? Date.now()),
  }
}

/** Handles /callback if that is where we are. Returns true if it handled one. */
export async function handleCallback(): Promise<boolean> {
  if (location.pathname !== '/callback') return false
  const params = new URLSearchParams(location.search)
  const pending = read<PendingLogin>(PKCE_KEY)
  const rec: Sp1Record = {
    loginStartedStandalone: pending?.standalone ?? null,
    callbackStandalone: isStandalone(),
    verifierFound: pending !== null,
    stateMatched: pending !== null && pending.state === params.get('state'),
    exchanged: false,
    at: Date.now(),
  }
  try {
    const error = params.get('error')
    const code = params.get('code')
    if (error) throw new Error(`authorize: ${error}`)
    if (!code) throw new Error('no code in callback')
    if (!pending) throw new Error('no PKCE verifier in this context (SP1: storage not shared)')
    if (!rec.stateMatched) throw new Error('state mismatch')
    write(
      TOKENS_KEY,
      await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: pending.verifier }),
    )
    rec.exchanged = true
    localStorage.removeItem(PKCE_KEY)
  } catch (err) {
    rec.error = String(err)
  }
  write(SP1_KEY, rec)
  log(rec.exchanged ? 'info' : 'error', 'auth.callback', rec)
  history.replaceState(null, '', '/')
  return true
}

let refreshing: Promise<Tokens | null> | null = null

async function refresh(t: Tokens): Promise<Tokens | null> {
  try {
    const next = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken })
    write(TOKENS_KEY, next)
    log('info', 'auth.refreshed', { expiresIn: Math.round((next.expiresAt - Date.now()) / 1000) })
    return next
  } catch (err) {
    log('error', 'auth.refresh_failed', { err: String(err) })
    // invalid_grant: the refresh token is dead (revoked, or older than 6 months). Log in again.
    if (String(err).includes('invalid_grant')) localStorage.removeItem(TOKENS_KEY)
    return null
  }
}

/** A valid access token, refreshing if it expires within a minute. Null if logged out. */
export async function accessToken(force = false): Promise<string | null> {
  const t = loadTokens()
  if (!t) return null
  if (!force && t.expiresAt - Date.now() > 60_000) return t.accessToken
  refreshing ??= refresh(t).finally(() => (refreshing = null))
  return (await refreshing)?.accessToken ?? null
}
